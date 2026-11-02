import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { PgBoss } from 'pg-boss';
import { transaction, migrate } from './database.js';
import { JobInput, Limits, ProjectInput, STAGES, type NewJob, type Smoke, type JobLimits } from './contracts.js';
import type { Config } from './config.js';

export class ControllerError extends Error {
  constructor(public code: string, public httpStatus = 409) { super(code); }
}
export interface Claim {
  id: string; jobId: string; stageId: string; stage: string; number: number;
  deadline: Date; input: Smoke; projectId: string;
}
interface JobRow {
  id: string; project_id: string; status: string; input: Smoke; limits: JobLimits;
  used_tokens: number; used_cost_micros: number; generation: number;
  current_attempt_id: string | null; deadline_at: Date | null; lease_expires_at: Date | null;
  reason: string | null;
}
export interface JobSnapshot extends JobRow {
  stages: Array<{ id: string; name: string; ordinal: number; status: string; output: unknown }>;
  attempts: Array<{ id: string; status: string; error_code: string | null; number: number;
    reserved_tokens: number; reserved_cost_micros: number; usage_confirmed: boolean }>;
  artifacts: Array<{ id: string; sha256: string; bytes: number; media_type: string; candidate_revision: string | null }>;
  events: Array<{ id: string; type: string; data: Record<string, unknown> }>;
  requirements: Array<{ key: string; description: string; required: boolean; status: string }>;
}
const QUEUE = 'factory-stage-v1';

export class Controller {
  readonly pool: Pool;
  readonly boss: PgBoss;
  constructor(readonly config: Config) {
    this.pool = new Pool({ connectionString: config.databaseUrl, max: 6, connectionTimeoutMillis: 5000,
      statement_timeout: 10_000, idle_in_transaction_session_timeout: 15_000 });
    this.pool.on('error', () => console.error(JSON.stringify({ event: 'database_connection_error' })));
    this.boss = new PgBoss({ connectionString: config.databaseUrl, schema: 'factory_queue', max: 6 });
    this.boss.on('error', () => console.error(JSON.stringify({ event: 'queue_error' })));
  }
  async open() {
    await migrate(this.pool);
    await mkdir(this.config.artifactRoot, { recursive: true, mode: 0o700 });
    await this.boss.start();
    await this.boss.createQueue(QUEUE, { retryLimit: 5, retryDelay: 1, retryBackoff: true,
      expireInSeconds: 900, retentionSeconds: 86_400, deleteAfterSeconds: 86_400 });
    return this;
  }
  async close() {
    await this.boss.stop({ graceful: true, timeout: 5000 });
    await this.pool.end();
  }
  private async event(client: PoolClient, jobId: string, type: string, data: object = {}) {
    await client.query('INSERT INTO factory.events(job_id,type,data) VALUES($1,$2,$3)', [jobId, type, data]);
  }
  private async enqueue(client: PoolClient, jobId: string, delayMs = 0) {
    await this.boss.send(QUEUE, { jobId }, { startAfter: new Date(Date.now() + delayMs),
      db: { executeSql: (text, values) => client.query(text, values) } });
  }
  async createProject(ownerId: string, raw: unknown) {
    const input = ProjectInput.parse(raw);
    const result = await this.pool.query('INSERT INTO factory.projects(id,owner_id,name,site_type) VALUES($1,$2,$3,$4) RETURNING *',
      [randomUUID(), ownerId, input.name, input.siteType]);
    return result.rows[0];
  }
  async listProjects(ownerId: string) {
    return (await this.pool.query('SELECT * FROM factory.projects WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100', [ownerId])).rows;
  }
  async createJob(ownerId: string, raw: unknown) {
    const input: NewJob = JobInput.parse(raw);
    if (new Set(input.requirements.map(item => item.key)).size !== input.requirements.length) throw new ControllerError('duplicate_requirement', 400);
    return transaction(this.pool, async client => {
      const project = await client.query('SELECT id FROM factory.projects WHERE id=$1 AND owner_id=$2 FOR SHARE', [input.projectId, ownerId]);
      if (!project.rowCount) throw new ControllerError('not_found', 404);
      const id = randomUUID();
      await client.query("INSERT INTO factory.jobs(id,project_id,pipeline,status,input,limits) VALUES($1,$2,$3,'queued',$4,$5)",
        [id, input.projectId, input.pipeline, input.input, input.limits]);
      for (const [ordinal, name] of STAGES.entries()) {
        await client.query('INSERT INTO factory.stages(id,job_id,name,ordinal) VALUES($1,$2,$3,$4)', [randomUUID(), id, name, ordinal]);
      }
      for (const requirement of input.requirements) {
        await client.query('INSERT INTO factory.requirements(job_id,key,description,required) VALUES($1,$2,$3,$4)',
          [id, requirement.key, requirement.description, requirement.required]);
      }
      await this.event(client, id, 'job_created', { pipeline: input.pipeline });
      await this.enqueue(client, id);
      return { id, status: 'queued' };
    });
  }
  async inspect(ownerId: string, id: string): Promise<JobSnapshot> {
    const job = (await this.pool.query(`SELECT j.* FROM factory.jobs j JOIN factory.projects p ON p.id=j.project_id
      WHERE j.id=$1 AND p.owner_id=$2`, [id, ownerId])).rows[0];
    if (!job) throw new ControllerError('not_found', 404);
    const [stages, attempts, artifacts, events, requirements] = await Promise.all([
      this.pool.query('SELECT * FROM factory.stages WHERE job_id=$1 ORDER BY ordinal', [id]),
      this.pool.query('SELECT * FROM factory.attempts WHERE job_id=$1 ORDER BY started_at LIMIT 1000', [id]),
      this.pool.query('SELECT id,job_id,attempt_id,stage_id,sha256,media_type,bytes,candidate_revision,created_at FROM factory.artifacts WHERE job_id=$1 ORDER BY created_at', [id]),
      this.pool.query('SELECT * FROM factory.events WHERE job_id=$1 ORDER BY id LIMIT 1000', [id]),
      this.pool.query('SELECT * FROM factory.requirements WHERE job_id=$1 ORDER BY key', [id]),
    ]);
    return { ...job, stages: stages.rows, attempts: attempts.rows, artifacts: artifacts.rows,
      events: events.rows, requirements: requirements.rows };
  }
  async cancel(ownerId: string, id: string) {
    return transaction(this.pool, async client => {
      const result = await client.query(`SELECT j.* FROM factory.jobs j JOIN factory.projects p ON p.id=j.project_id
        WHERE j.id=$1 AND p.owner_id=$2 FOR UPDATE OF j`, [id, ownerId]);
      const job = result.rows[0];
      if (!job) throw new ControllerError('not_found', 404);
      if (job.status === 'completed') throw new ControllerError('already_completed');
      if (job.status === 'cancelled') return { id, status: 'cancelled' };
      await client.query("UPDATE factory.attempts SET status='cancelled',finished_at=clock_timestamp(),error_code='operator_cancelled' WHERE id=$1 AND status='running'", [job.current_attempt_id]);
      await client.query("UPDATE factory.stages SET status='cancelled' WHERE job_id=$1 AND status <> 'completed'", [id]);
      await client.query("UPDATE factory.jobs SET status='cancelled',reason='operator_cancelled',current_attempt_id=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1", [id]);
      await this.event(client, id, 'job_cancelled');
      return { id, status: 'cancelled' };
    });
  }
  async resume(ownerId: string, id: string, rawLimits: unknown) {
    const limits = Limits.parse(rawLimits);
    return transaction(this.pool, async client => {
      const result = await client.query(`SELECT j.* FROM factory.jobs j JOIN factory.projects p ON p.id=j.project_id
        WHERE j.id=$1 AND p.owner_id=$2 FOR UPDATE OF j`, [id, ownerId]);
      const job = result.rows[0];
      if (!job) throw new ControllerError('not_found', 404);
      if (!['needs_review', 'failed', 'cancelled'].includes(job.status)) throw new ControllerError('not_resumable');
      if (limits.maxTokens < job.used_tokens || limits.maxCostMicros < job.used_cost_micros) throw new ControllerError('budget_below_reserved_usage');
      await client.query("UPDATE factory.stages SET status='pending' WHERE job_id=$1 AND status <> 'completed'", [id]);
      await client.query(`UPDATE factory.jobs SET status='queued',limits=$2,generation=generation+1,
        current_attempt_id=NULL,lease_expires_at=NULL,started_at=NULL,deadline_at=NULL,reason=NULL,
        available_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`, [id, limits]);
      await this.event(client, id, 'operator_resumed', { limits });
      await this.enqueue(client, id);
      return { id, status: 'queued' };
    });
  }
  async claim(jobId: string, workerId: string): Promise<Claim | null> {
    return transaction(this.pool, async client => {
      const job: JobRow | undefined = (await client.query('SELECT * FROM factory.jobs WHERE id=$1 FOR UPDATE', [jobId])).rows[0];
      if (!job || job.status !== 'queued') return null;
      const now: Date = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      const available: Date = (await client.query('SELECT available_at FROM factory.jobs WHERE id=$1', [jobId])).rows[0].available_at;
      if (available > now) return null;
      const limits = Limits.parse(job.limits);
      const deadline = job.deadline_at ?? new Date(now.getTime() + limits.maxRuntimeMs);
      const stage = (await client.query("SELECT * FROM factory.stages WHERE job_id=$1 AND status='pending' ORDER BY ordinal LIMIT 1", [jobId])).rows[0];
      if (!stage) return null;
      let blocked: string | null = deadline <= now ? 'wall_clock_limit' : null;
      if (job.used_tokens + job.input.tokensPerStage > limits.maxTokens ||
          job.used_cost_micros + job.input.costMicrosPerStage > limits.maxCostMicros) blocked = 'budget_exhausted';
      if (blocked) {
        await client.query("UPDATE factory.jobs SET status='needs_review',reason=$2,updated_at=clock_timestamp() WHERE id=$1", [jobId, blocked]);
        await this.event(client, jobId, 'needs_review', { reason: blocked });
        return null;
      }
      const count = (await client.query('SELECT count(*)::int AS n FROM factory.attempts WHERE stage_id=$1 AND generation=$2', [stage.id, job.generation])).rows[0].n;
      if (count > limits.maxRetries) {
        await client.query("UPDATE factory.jobs SET status='failed',reason='retries_exhausted',updated_at=clock_timestamp() WHERE id=$1", [jobId]);
        await client.query("UPDATE factory.stages SET status='failed' WHERE id=$1", [stage.id]);
        await this.event(client, jobId, 'job_failed', { reason: 'retries_exhausted' });
        return null;
      }
      const id = randomUUID();
      const attemptDeadline = new Date(Math.min(deadline.getTime(), now.getTime() + limits.stageTimeoutMs));
      const leaseEnd = new Date(Math.min(attemptDeadline.getTime(), now.getTime() + this.config.leaseMs));
      await client.query(`INSERT INTO factory.attempts(id,job_id,stage_id,generation,number,worker_id,status,reserved_tokens,reserved_cost_micros,deadline_at)
        VALUES($1,$2,$3,$4,$5,$6,'running',$7,$8,$9)`, [id, jobId, stage.id, job.generation, count + 1, workerId,
        job.input.tokensPerStage, job.input.costMicrosPerStage, attemptDeadline]);
      await client.query(`UPDATE factory.jobs SET status='running',current_attempt_id=$2,heartbeat_at=$3,lease_expires_at=$4,
        started_at=COALESCE(started_at,$3),deadline_at=$5,used_tokens=used_tokens+$6,used_cost_micros=used_cost_micros+$7,
        updated_at=$3,reason=NULL WHERE id=$1`, [jobId, id, now, leaseEnd, deadline, job.input.tokensPerStage, job.input.costMicrosPerStage]);
      await client.query("UPDATE factory.stages SET status='running' WHERE id=$1", [stage.id]);
      await this.event(client, jobId, 'attempt_started', { attemptId: id, stage: stage.name, number: count + 1 });
      return { id, jobId, stageId: stage.id, stage: stage.name, number: count + 1, deadline: attemptDeadline,
        input: job.input, projectId: job.project_id };
    });
  }
  async heartbeat(claim: Claim): Promise<boolean> {
    const result = await this.pool.query(`WITH refreshed AS (UPDATE factory.jobs j SET heartbeat_at=clock_timestamp(),updated_at=clock_timestamp(),
      lease_expires_at=LEAST(a.deadline_at,j.deadline_at,clock_timestamp()+($3 * interval '1 millisecond'))
      FROM factory.attempts a WHERE j.id=$1 AND j.current_attempt_id=$2 AND a.id=$2 AND j.status='running'
      AND j.lease_expires_at>clock_timestamp() AND a.deadline_at>clock_timestamp() AND j.deadline_at>clock_timestamp()
      RETURNING j.id), touched AS (UPDATE factory.attempts SET heartbeat_at=clock_timestamp()
        WHERE id=$2 AND status='running' AND EXISTS(SELECT 1 FROM refreshed) RETURNING id)
      SELECT id FROM refreshed`, [claim.jobId, claim.id, this.config.leaseMs]);
    return Boolean(result.rowCount);
  }
  async complete(claim: Claim, output: object): Promise<boolean> {
    const content = Buffer.from(JSON.stringify(output) + '\n');
    const hash = createHash('sha256').update(content).digest('hex');
    const storageKey = join(claim.jobId, claim.id, `${hash}.json`);
    await mkdir(join(this.config.artifactRoot, claim.jobId, claim.id), { recursive: true, mode: 0o700 });
    await writeFile(join(this.config.artifactRoot, storageKey), content, { mode: 0o600, flag: 'wx', flush: true }).catch(async error => {
      if (error.code !== 'EEXIST') throw error;
      const existing = await readFile(join(this.config.artifactRoot, storageKey));
      if (!existing.equals(content)) throw new ControllerError('artifact_integrity_error');
    });
    return transaction(this.pool, async client => {
      // The controller, not the handler's completion message, authorizes publication.
      const job = (await client.query(`SELECT j.* FROM factory.jobs j JOIN factory.attempts a ON a.id=j.current_attempt_id
        WHERE j.id=$1 AND j.current_attempt_id=$2 AND j.status='running' AND j.lease_expires_at>clock_timestamp()
        AND j.deadline_at>clock_timestamp() AND a.deadline_at>clock_timestamp() FOR UPDATE OF j`, [claim.jobId, claim.id])).rows[0];
      if (!job) return false;
      await client.query('INSERT INTO factory.smoke_effects(job_id,stage_name,attempt_id) VALUES($1,$2,$3)', [claim.jobId, claim.stage, claim.id]);
      await client.query(`INSERT INTO factory.artifacts(id,job_id,attempt_id,stage_id,sha256,media_type,bytes,storage_key)
        VALUES($1,$2,$3,$4,$5,'application/json',$6,$7)`, [randomUUID(), claim.jobId, claim.id, claim.stageId, hash, content.length, storageKey]);
      await client.query("UPDATE factory.attempts SET status='completed',usage_confirmed=true,finished_at=clock_timestamp() WHERE id=$1", [claim.id]);
      await client.query("UPDATE factory.stages SET status='completed',output=$2 WHERE id=$1", [claim.stageId, output]);
      const remaining = (await client.query("SELECT 1 FROM factory.stages WHERE job_id=$1 AND status <> 'completed' LIMIT 1", [claim.jobId])).rowCount;
      await client.query(`UPDATE factory.jobs SET status=$2,current_attempt_id=NULL,lease_expires_at=NULL,heartbeat_at=NULL,
        available_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`, [claim.jobId, remaining ? 'queued' : 'completed']);
      await this.event(client, claim.jobId, 'stage_completed', { stage: claim.stage, attemptId: claim.id });
      if (remaining) await this.enqueue(client, claim.jobId);
      else await this.event(client, claim.jobId, 'job_completed', { scope: 'controller-smoke-only' });
      return true;
    });
  }
  async fail(claim: Claim, code: 'transient_error' | 'worker_shutdown' | 'stage_timeout' | 'handler_error') {
    return transaction(this.pool, async client => {
      const job: JobRow | undefined = (await client.query("SELECT * FROM factory.jobs WHERE id=$1 AND current_attempt_id=$2 AND status='running' AND ($3::boolean OR lease_expires_at>clock_timestamp()) FOR UPDATE", [claim.jobId, claim.id, code === 'stage_timeout'])).rows[0];
      if (!job) return false;
      const now: Date = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      const timedOut = code === 'stage_timeout';
      const wallTime = job.deadline_at !== null && job.deadline_at <= now;
      const retry = ['transient_error', 'worker_shutdown'].includes(code) && claim.number <= job.limits.maxRetries && !wallTime;
      const reason = wallTime ? 'wall_clock_limit' : timedOut ? 'stage_timeout' : retry || code === 'handler_error' ? code : 'retries_exhausted';
      const delay = retry ? Math.min(60_000, this.config.retryDelayMs * 2 ** (claim.number - 1)) : 0;
      const status = wallTime || timedOut ? 'needs_review' : retry ? 'queued' : 'failed';
      await client.query("UPDATE factory.attempts SET status=$2,finished_at=clock_timestamp(),error_code=$3 WHERE id=$1", [claim.id, timedOut ? 'timed_out' : 'failed', code]);
      await client.query('UPDATE factory.stages SET status=$2 WHERE id=$1', [claim.stageId, retry ? 'pending' : 'failed']);
      await client.query(`UPDATE factory.jobs SET status=$2,reason=$3,current_attempt_id=NULL,lease_expires_at=NULL,
        available_at=clock_timestamp()+($4 * interval '1 millisecond'),updated_at=clock_timestamp() WHERE id=$1`, [claim.jobId, status, reason, delay]);
      await this.event(client, claim.jobId, retry ? 'attempt_retry_scheduled' : status, { reason, attemptId: claim.id });
      if (retry) await this.enqueue(client, claim.jobId, delay);
      return true;
    });
  }
  async recover() {
    return transaction(this.pool, async client => {
      const expired = await client.query(`SELECT j.*,a.stage_id,a.deadline_at AS attempt_deadline FROM factory.jobs j
        JOIN factory.attempts a ON a.id=j.current_attempt_id WHERE j.status='running' AND j.lease_expires_at<=clock_timestamp()
        ORDER BY j.lease_expires_at LIMIT 20 FOR UPDATE OF j SKIP LOCKED`);
      for (const job of expired.rows) {
        const now: Date = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
        const timeout = job.attempt_deadline <= now;
        const reason = job.deadline_at <= now ? 'wall_clock_limit' : timeout ? 'stage_timeout' : 'worker_lost';
        const status = reason === 'worker_lost' ? 'queued' : 'needs_review';
        await client.query("UPDATE factory.attempts SET status=$2,finished_at=clock_timestamp(),error_code=$3 WHERE id=$1", [job.current_attempt_id, timeout ? 'timed_out' : 'interrupted', reason]);
        await client.query('UPDATE factory.stages SET status=$2 WHERE id=$1', [job.stage_id, status === 'queued' ? 'pending' : 'failed']);
        await client.query(`UPDATE factory.jobs SET status=$2,reason=$3,current_attempt_id=NULL,lease_expires_at=NULL,
          available_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`, [job.id, status, reason]);
        await this.event(client, job.id, 'attempt_recovered', { reason, attemptId: job.current_attempt_id });
        if (status === 'queued') await this.enqueue(client, job.id);
      }
      // Rescue delivery lost before a handler could claim an application lease.
      // Duplicate queue deliveries cannot claim a running/completed stage.
      const stranded = await client.query(`SELECT id FROM factory.jobs WHERE status='queued'
        AND available_at < clock_timestamp()-($1 * interval '1 millisecond') LIMIT 20 FOR UPDATE SKIP LOCKED`, [Math.max(2000, this.config.leaseMs * 2)]);
      for (const job of stranded.rows) {
        await this.enqueue(client, job.id);
        await client.query('UPDATE factory.jobs SET available_at=clock_timestamp() WHERE id=$1', [job.id]);
      }
      return expired.rowCount;
    });
  }
  async registerWorker(handler: (jobId: string) => Promise<void>) {
    return this.boss.work<{ jobId: string }>(QUEUE, { pollingIntervalSeconds: 0.5, localConcurrency: 1 }, async jobs => {
      for (const job of jobs) await handler(job.data.jobId);
    });
  }
  async unregisterWorker(id: string) { await this.boss.offWork(QUEUE, { id, wait: true }); }
}
