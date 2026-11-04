import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, type FileHandle } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Server } from 'node:http';
import type { PoolClient } from 'pg';
import { Controller, ControllerError } from './controller.js';
import { transaction } from './database.js';
import { CreateEnvironment, type EnvironmentRow, type EnvironmentAction } from './environment-contracts.js';
import { createPreview, pinPreviewSocket } from './preview.js';
import {ensureThemeBaseline,selectProjectTheme} from './themes.js';

const exec = promisify(execFile);
const QUEUE = 'factory-environments-v1';
export class Environments {
  private previews = new Map<string, { server: Server; socket: FileHandle }>();
  private timer?: ReturnType<typeof setInterval>;
  private checking: Promise<unknown> | null = null;
  private registration?: string;
  constructor(readonly controller: Controller) {}
  private get config() { return this.controller.config; }
  private directory(id: string) { return join(this.config.environmentRoot, 'instances', id); }
  async runtime(action: string, id: string, extra: string[] = [], input?: object | string): Promise<Record<string, any>> {
    const command = exec('python3', [resolve('tools/environments.py'), action, id, ...extra], {
      cwd: process.cwd(), env: { ...process.env, FACTORY_ENV_ROOT: this.config.environmentRoot, FACTORY_THEME_ROOT:this.config.themeRoot },
      timeout: 600_000, maxBuffer: 1024 * 1024,
    });
    command.child.stdin?.end(typeof input === 'string' ? input : JSON.stringify(input ?? {}));
    const result = await command;
    return JSON.parse(result.stdout);
  }
  async open() {
    await ensureThemeBaseline(this.controller);
    await mkdir(this.config.environmentRoot, { recursive: true, mode: 0o700 });
    const queueOptions = { retryLimit: 3, retryDelay: 2, expireInSeconds: 900 };
    await this.controller.boss.createQueue(QUEUE, queueOptions);
    await this.controller.boss.updateQueue(QUEUE, queueOptions);
    this.registration = await this.controller.boss.work<{ operationId: string }>(QUEUE,
      { pollingIntervalSeconds: 0.5, localConcurrency: 1 }, async jobs => {
        for (const job of jobs) await this.perform(job.data.operationId);
      });
    await this.monitor();
    this.timer = setInterval(() => {
      if (!this.checking) this.checking = this.monitor().catch(() => {
        console.error(JSON.stringify({ event: 'environment_monitor_error' }));
      }).finally(() => { this.checking = null; });
    }, 5000);
    return this;
  }
  async close() {
    clearInterval(this.timer);
    if (this.checking) await this.checking;
    if (this.registration) await this.controller.boss.offWork(QUEUE, { id: this.registration, wait: true });
    for (const id of this.previews.keys()) await this.closePreview(id);
  }
  private async owned(owner: string, id: string): Promise<EnvironmentRow> {
    const row = (await this.controller.pool.query(`SELECT e.* FROM factory.environments e
      JOIN factory.projects p ON p.id=e.project_id WHERE e.id=$1 AND p.owner_id=$2`, [id, owner])).rows[0];
    if (!row) throw new ControllerError('not_found', 404);
    return row;
  }
  private async queue(client: PoolClient, environmentId: string, action: EnvironmentAction, input: object = {}) {
    const id = randomUUID();
    await client.query("INSERT INTO factory.environment_operations(id,environment_id,action,input,status) VALUES($1,$2,$3,$4,'queued')", [id, environmentId, action, input]);
    await client.query('UPDATE factory.environments SET current_operation_id=$2,updated_at=clock_timestamp() WHERE id=$1', [environmentId, id]);
    await this.controller.boss.send(QUEUE, { operationId: id }, { db: { executeSql: (text, values) => client.query(text, values) } });
    return id;
  }
  async create(owner: string, raw: unknown, internal?:{themeCertificationId?:string;allocationKey?:string}) {
    const input = CreateEnvironment.parse(raw);
    await ensureThemeBaseline(this.controller);
    return transaction(this.controller.pool, async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('factory-environment-allocation',0))");
      const project = (await client.query('SELECT * FROM factory.projects WHERE id=$1 AND owner_id=$2', [input.projectId, owner])).rows[0];
      if (!project) throw new ControllerError('not_found', 404);
      if (project.site_type !== 'wordpress') throw new ControllerError('environment_profile_not_implemented');
      if(internal?.allocationKey){
        const existing=(await client.query('SELECT * FROM factory.environments WHERE allocation_key=$1',[internal.allocationKey])).rows[0];
        if(existing){if(existing.project_id!==project.id||input.themeBundleId&&existing.theme_bundle_id!==input.themeBundleId)throw new ControllerError('environment_allocation_conflict');
          return{id:existing.id,status:existing.status,operationId:existing.current_operation_id};}
      }
      const theme=await selectProjectTheme(this.controller,client,input.projectId,input.themeBundleId,Boolean(internal?.themeCertificationId&&internal.themeCertificationId===input.themeBundleId));
      const used = (await client.query("SELECT preview_port FROM factory.environments WHERE status <> 'deleted'")).rows.map(row => row.preview_port);
      if (used.length >= this.config.maxEnvironments) throw new ControllerError('environment_capacity_reached');
      let port = this.config.previewPortBase;
      while (used.includes(port)) port++;
      const id = randomUUID();
      await client.query(`INSERT INTO factory.environments(id,project_id,status,limits,preview_port,retain_until,theme_bundle_id,allocation_key)
        VALUES($1,$2,'creating',$3,$4,clock_timestamp()+($5 * interval '1 second'),$6,$7)`,
      [id, input.projectId, input.limits, port, input.limits.retentionSeconds,theme.id,internal?.allocationKey??null]);
      const operationId = await this.queue(client, id, 'create');
      return { id, status: 'creating', operationId };
    });
  }
  async inspect(owner: string, id: string) {
    const row = await this.owned(owner, id);
    let previewUrl: string | null = null;
    if (row.status === 'running') {
      const secret = JSON.parse(await readFile(join(this.directory(row.id), 'private.json'), 'utf8'));
      previewUrl = `http://127.0.0.1:${row.preview_port}/__factory_auth?token=${secret.previewToken}`;
    }
    const operations = (await this.controller.pool.query('SELECT id,action,status,error_code,result,created_at,updated_at FROM factory.environment_operations WHERE environment_id=$1 ORDER BY created_at', [id])).rows;
    const snapshots = (await this.controller.pool.query('SELECT id,sha256,created_at FROM factory.environment_snapshots WHERE environment_id=$1 ORDER BY created_at', [id])).rows;
    return { ...row, previewUrl, operations, snapshots };
  }
  async credentials(owner: string, id: string) {
    const row = await this.owned(owner, id);
    if (row.status === 'deleted' || row.status === 'creating') throw new ControllerError('environment_unavailable');
    const secret = JSON.parse(await readFile(join(this.directory(row.id), 'private.json'), 'utf8'));
    return { username: 'client_admin', password: secret.adminPassword };
  }
  async request(owner: string, id: string, action: Exclude<EnvironmentAction, 'create'>, snapshotId?: string, internal?:{visualReviewId?:string;functionalReviewId?:string}) {
    await this.owned(owner, id);
    return transaction(this.controller.pool, async client => {
      const row: EnvironmentRow = (await client.query('SELECT * FROM factory.environments WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (row.current_operation_id) throw new ControllerError('environment_busy');
      const review=await client.query(`SELECT v.id,v.qa_environment_id FROM factory.visual_reviews v JOIN factory.agent_runs r ON r.id=v.candidate_run_id
        WHERE (r.environment_id=$1 OR v.qa_environment_id=$1) AND v.status IN ('queued','running','cancelling')`,[row.id]);
      if(review.rows.some(v=>v.id!==internal?.visualReviewId||v.qa_environment_id!==row.id))throw new ControllerError('visual_review_active');
      const functional=await client.query(`SELECT v.id,v.qa_environment_id FROM factory.functional_reviews v JOIN factory.agent_runs r ON r.id=v.candidate_run_id
        WHERE (r.environment_id=$1 OR v.qa_environment_id=$1) AND v.status IN ('queued','running','cancelling')`,[row.id]);
      if(functional.rows.some(v=>v.id!==internal?.functionalReviewId||v.qa_environment_id!==row.id))throw new ControllerError('functional_review_active');
      const agent=await client.query("SELECT 1 FROM factory.agent_runs WHERE environment_id=$1 AND status IN ('queued','running','cancelling')",[row.id]);
      if(agent.rowCount)throw new ControllerError('agent_run_active');
      if (row.status === 'deleted') throw new ControllerError('environment_deleted');
      if (action === 'start' && row.status === 'running') return { id, status: 'running' };
      if (['snapshot','restore'].includes(action) && row.status !== 'stopped') throw new ControllerError('stop_environment_first');
      if (action === 'restore') {
        const found = await client.query('SELECT 1 FROM factory.environment_snapshots WHERE id=$1 AND environment_id=$2', [snapshotId, id]);
        if (!found.rowCount) throw new ControllerError('snapshot_not_found', 404);
      }
      if (action === 'start') {
        await client.query(`UPDATE factory.environments SET expires_at=clock_timestamp()+($2 * interval '1 second'),
          retain_until=clock_timestamp()+($3 * interval '1 second') WHERE id=$1`, [id, row.limits.ttlSeconds, row.limits.ttlSeconds + row.limits.retentionSeconds]);
      }
      const statuses = { start: 'starting', stop: 'stopping', destroy: 'deleting', snapshot: 'snapshotting', restore: 'restoring' };
      await client.query('UPDATE factory.environments SET status=$2,reason=NULL WHERE id=$1', [id, statuses[action]]);
      const input = ['snapshot','restore'].includes(action) ? { snapshotId: snapshotId ?? randomUUID() } : {};
      const operationId = await this.queue(client, id, action, input);
      return { id, status: statuses[action], operationId };
    });
  }
  async probe(owner: string, id: string, profile: 'website' | 'reference') {
    const row = await this.owned(owner, id);
    if (row.status !== 'running' || row.current_operation_id) throw new ControllerError('environment_not_running');
    return this.runtime('probe', row.id, [profile]);
  }
  private async perform(operationId: string) {
    const attemptId = randomUUID();
    const op = (await this.controller.pool.query(`UPDATE factory.environment_operations SET status='running',attempt_id=$2,
      lease_expires_at=clock_timestamp()+interval '30 seconds',updated_at=clock_timestamp() WHERE id=$1 AND status='queued' RETURNING *`, [operationId, attemptId])).rows[0];
    if (!op) return;
    const heartbeat = setInterval(() => {
      void this.controller.pool.query(`UPDATE factory.environment_operations SET lease_expires_at=clock_timestamp()+interval '30 seconds',
        updated_at=clock_timestamp() WHERE id=$1 AND attempt_id=$2 AND status='running' AND lease_expires_at>clock_timestamp()`, [operationId, attemptId])
        .catch(() => {});
    }, 5000);
    try {
      const row: EnvironmentRow = (await this.controller.pool.query('SELECT * FROM factory.environments WHERE id=$1', [op.environment_id])).rows[0];
      const theme=row.theme_bundle_id?(await this.controller.pool.query('SELECT id,source_digest FROM factory.theme_bundles WHERE id=$1',[row.theme_bundle_id])).rows[0]:null;
      if (op.action !== 'start' && op.action !== 'create') await this.closePreview(row.id);
      const result = await this.runtime(op.action, row.id,
        op.input.snapshotId ? [op.input.snapshotId] : [],
        op.action === 'create' ? { projectId: row.project_id, port: row.preview_port, limits: row.limits, ...(theme?{themeBundle:{id:theme.id,sourceDigest:theme.source_digest}}:{}) } : undefined);
      const statuses: Record<string, string> = { create: 'stopped', start: 'running', stop: 'stopped', destroy: 'deleted', snapshot: 'stopped', restore: 'stopped' };
      if (op.action === 'start') await this.openPreview(row);
      const committed = await transaction(this.controller.pool, async client => {
        const valid = await client.query(`SELECT id FROM factory.environment_operations WHERE id=$1 AND attempt_id=$2
          AND status='running' AND lease_expires_at>clock_timestamp() FOR UPDATE`, [operationId, attemptId]);
        if (!valid.rowCount) return false;
        if (op.action === 'snapshot') await client.query(`INSERT INTO factory.environment_snapshots(id,environment_id,sha256) VALUES($1,$2,$3)
          ON CONFLICT(id) DO NOTHING`, [op.input.snapshotId, row.id, result.sha256]);
        await client.query("UPDATE factory.environment_operations SET status='completed',result=$2,updated_at=clock_timestamp() WHERE id=$1", [operationId, result]);
        await client.query('UPDATE factory.environments SET status=$2,current_operation_id=NULL,updated_at=clock_timestamp() WHERE id=$1 AND current_operation_id=$3', [row.id, statuses[op.action], operationId]);
        await client.query('INSERT INTO factory.environment_events(environment_id,type,data) VALUES($1,$2,$3)', [row.id, op.action + '_completed', { operationId }]);
        return true;
      });
      if (!committed && op.action === 'start') await this.closePreview(row.id);
    } catch {
      const current = await this.controller.pool.query(`SELECT 1 FROM factory.environment_operations WHERE id=$1 AND attempt_id=$2
        AND status='running' AND lease_expires_at>clock_timestamp()`, [operationId, attemptId]);
      if (op.action === 'start' && current.rowCount) {
        await this.closePreview(op.environment_id);
        await this.runtime('stop', op.environment_id).catch(() => {});
      }
      await transaction(this.controller.pool, async client => {
        const valid = await client.query(`UPDATE factory.environment_operations SET status='failed',error_code='runtime_failed',updated_at=clock_timestamp()
          WHERE id=$1 AND attempt_id=$2 AND status='running' AND lease_expires_at>clock_timestamp() RETURNING environment_id`, [operationId, attemptId]);
        if (valid.rowCount) await client.query("UPDATE factory.environments SET status='failed',reason='runtime_failed',current_operation_id=NULL,updated_at=clock_timestamp() WHERE id=$1 AND current_operation_id=$2", [op.environment_id, operationId]);
      });
    } finally { clearInterval(heartbeat); }
  }
  private async openPreview(row: EnvironmentRow) {
    if (this.previews.has(row.id)) return;
    const data = JSON.parse(await readFile(join(this.directory(row.id), 'private.json'), 'utf8'));
    // A pinned inode handles deep paths and prevents a socket-path symlink
    // replacement from redirecting this trusted proxy to another environment.
    const socket = await pinPreviewSocket(join(this.directory(row.id), 'run', 'preview.sock'));
    const server = createPreview(row.preview_port, row.id, data.previewToken, `/proc/self/fd/${socket.fd}`);
    try {
      await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(row.preview_port, '127.0.0.1', done); });
      this.previews.set(row.id, { server, socket });
    } catch (error) { await socket.close(); throw error; }
  }
  private async closePreview(id: string) {
    const item = this.previews.get(id);
    if (!item) return;
    const { server, socket } = item;
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
    this.previews.delete(id);
    await socket.close();
  }
  async monitor() {
    await transaction(this.controller.pool, async client => {
      const lost = await client.query(`UPDATE factory.environment_operations SET status='queued',attempt_id=NULL
        WHERE status='running' AND lease_expires_at<clock_timestamp() RETURNING id`);
      // Re-enqueue queued operations too, covering a crash before an application claim.
      const queued = await client.query("SELECT id FROM factory.environment_operations WHERE status='queued' AND updated_at<clock_timestamp()-interval '10 seconds'");
      for (const op of [...lost.rows, ...queued.rows]) {
        await this.controller.boss.send(QUEUE, { operationId: op.id }, { db: { executeSql: (text, values) => client.query(text, values) } });
        await client.query('UPDATE factory.environment_operations SET updated_at=clock_timestamp() WHERE id=$1', [op.id]);
      }
    });
    const rows: EnvironmentRow[] = (await this.controller.pool.query("SELECT * FROM factory.environments WHERE status <> 'deleted' AND current_operation_id IS NULL")).rows;
    for (const row of rows) {
      if (row.retain_until && row.retain_until.getTime() < Date.now()) {
        await this.maintenance(row.id, 'destroy', 'retention_expired'); continue;
      }
      if (row.status === 'running') {
        if (row.expires_at && row.expires_at.getTime() < Date.now()) {
          await this.maintenance(row.id, 'stop', 'ttl_expired'); continue;
        }
        try {
          const state = await this.runtime('status', row.id);
          if (!state.running || state.fileLimit || state.bytes > row.limits.diskMiB * 1024 * 1024) {
            await this.maintenance(row.id, 'stop', state.running ? 'disk_limit' : 'runtime_stopped');
          } else await this.openPreview(row);
        } catch { console.error(JSON.stringify({ event: 'environment_status_error', environmentId: row.id })); }
      }
    }
  }
  private async maintenance(id: string, action: 'stop' | 'destroy', reason: string) {
    await this.closePreview(id);
    await transaction(this.controller.pool, async client => {
      const row = (await client.query('SELECT * FROM factory.environments WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (row.current_operation_id) return;
      await client.query('UPDATE factory.environments SET status=$2,reason=$3 WHERE id=$1', [id, action === 'stop' ? 'stopping' : 'deleting', reason]);
      await this.queue(client, id, action);
    });
  }
}
