import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Controller, type Claim } from '../../src/controller.js';
import { createApi } from '../../src/api.js';
import { startWorker } from '../../src/worker.js';
import { parseConfig } from '../../src/config.js';

const configFile = resolve('.runtime/controller/config.test.json');
const config = parseConfig(JSON.parse(await readFile(configFile, 'utf8')));
assert(new URL(config.databaseUrl).pathname.endsWith('_test'), 'Integration tests require their separate test database');
let controller: Controller;
const createdJobs: Array<{ id: string; owner: string }> = [];
before(async () => { controller = await new Controller(config).open(); });
after(async () => {
  for (const item of createdJobs) {
    await controller.cancel(item.owner, item.id).catch(error => {
      if (error.code !== 'already_completed') throw error;
    });
  }
  await controller.close();
});

async function waitFor<T>(probe: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await probe();
    if (accept(value)) return value;
    await delay(50);
  }
  throw new Error('Condition timed out');
}
async function job(input: object = {}, limits: object = {}, owner = config.ownerId) {
  const project = await controller.createProject(owner, { name: 'Controller integration fixture' });
  const created = await controller.createJob(owner, { projectId: project.id, pipeline: 'controller-smoke-v1', input,
    limits: { maxRuntimeMs: 30_000, stageTimeoutMs: 10_000, maxTokens: 1000, maxCostMicros: 10000, maxRetries: 2, ...limits } });
  createdJobs.push({ id: created.id, owner });
  return created;
}
const inspect = (id: string) => controller.inspect(config.ownerId, id);
async function effects(id: string) {
  return (await controller.pool.query('SELECT stage_name FROM factory.smoke_effects WHERE job_id=$1 ORDER BY stage_name', [id])).rows;
}
async function workerProcess(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts', 'worker'], {
    env: { ...process.env, FACTORY_CONFIG: configFile }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout!.on('data', chunk => output += chunk);
  child.stderr!.on('data', () => {});
  await waitFor(async () => ({ ready: output.includes('worker_ready'), exited: child.exitCode !== null }), state => {
    if (state.exited) throw new Error('Child worker exited during startup');
    return state.ready;
  });
  return child;
}
async function stopProcess(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill(signal);
  await Promise.race([exited, delay(10_000).then(() => { child.kill('SIGKILL'); throw new Error('Worker did not stop'); })]);
}

test('three-stage jobs persist effects, events, usage and hashed artifacts', async () => {
  const created = await job();
  const worker = await startWorker(controller);
  try {
    const done = await waitFor(() => inspect(created.id), state => state.status === 'completed');
    assert.deepEqual(done.stages.map(stage => stage.status), ['completed', 'completed', 'completed']);
    assert.equal(done.used_tokens, 30);
    assert.equal(done.used_cost_micros, 300);
    assert.equal(done.artifacts.length, 3);
    assert.equal((await effects(created.id)).length, 3);
    assert.equal(done.events.filter(event => event.type === 'job_completed').length, 1);
    for (const artifact of done.artifacts) {
      const row = (await controller.pool.query('SELECT storage_key FROM factory.artifacts WHERE id=$1', [artifact.id])).rows[0];
      const content = await readFile(join(config.artifactRoot, row.storage_key));
      assert.equal(createHash('sha256').update(content).digest('hex'), artifact.sha256);
      assert.equal(content.length, artifact.bytes);
      assert.equal('storage_key' in artifact, false);
    }
    assert.equal(await controller.claim(created.id, randomUUID()), null, 'Duplicate delivery cannot claim a completed job');
  } finally { await worker.stop(); }
});

test('job creation and queue enqueue roll back together after an injected enqueue failure', async () => {
  const project = await controller.createProject(config.ownerId, { name: 'Rollback fixture' });
  const original = controller.boss.send.bind(controller.boss);
  let sentId: string | null = null;
  const replacement = mock.method(controller.boss, 'send', async (...args: Parameters<typeof original>) => {
    sentId = await original(...args);
    throw new Error('Injected failure after queue INSERT but before transaction COMMIT');
  });
  try {
    await assert.rejects(controller.createJob(config.ownerId, { projectId: project.id, pipeline: 'controller-smoke-v1' }));
    assert(sentId, 'Test reached the queue insertion');
    assert.equal((await controller.pool.query('SELECT id FROM factory.jobs WHERE project_id=$1', [project.id])).rowCount, 0);
    assert.equal((await controller.pool.query('SELECT id FROM factory_queue.job WHERE id=$1', [sentId])).rowCount, 0);
  } finally { replacement.mock.restore(); }
});

test('concurrent claims reserve one attempt and one budget allocation', async () => {
  const created = await job();
  const claims = await Promise.all(Array.from({ length: 6 }, () => controller.claim(created.id, randomUUID())));
  assert.equal(claims.filter(Boolean).length, 1);
  const running = await inspect(created.id);
  assert.equal(running.attempts.length, 1);
  assert.equal(running.used_tokens, 10);
  await controller.cancel(config.ownerId, created.id);
});

test('heartbeats protect long stages while two workers and recovery loops compete', async () => {
  const created = await job({ delayMs: 5200 });
  const first = await startWorker(controller);
  const second = await startWorker(controller);
  try {
    const done = await waitFor(() => inspect(created.id), state => state.status === 'completed', 30_000);
    assert.equal(done.attempts.length, 3, 'Live leases must not be recovered as crashed workers');
    assert.equal((await effects(created.id)).length, 3);
    assert(done.attempts.every(attempt => attempt.status === 'completed'));
  } finally { await first.stop(); await second.stop(); }
});

test('a transient stage failure retries without repeating committed effects', async () => {
  const created = await job({ transientFailures: 1 });
  const worker = await startWorker(controller);
  try {
    const done = await waitFor(() => inspect(created.id), state => state.status === 'completed');
    assert.equal(done.attempts.length, 4);
    assert.equal(done.attempts.filter(attempt => attempt.error_code === 'transient_error').length, 1);
    assert.equal((await effects(created.id)).length, 3);
    assert.equal(done.used_tokens, 40, 'Failed attempt reservations remain charged');
  } finally { await worker.stop(); }
});

test('reconciliation rescues a queue delivery lost before an attempt was claimed', async () => {
  const created = await job();
  const queued = await controller.pool.query("SELECT id FROM factory_queue.job WHERE data->>'jobId'=$1", [created.id]);
  assert.equal(queued.rowCount, 1);
  await controller.boss.cancel('factory-stage-v1', queued.rows[0].id);
  await controller.pool.query("UPDATE factory.jobs SET available_at=clock_timestamp()-interval '1 minute' WHERE id=$1", [created.id]);
  await controller.recover();
  const worker = await startWorker(controller);
  try {
    await waitFor(() => inspect(created.id), state => state.status === 'completed');
    assert.equal((await effects(created.id)).length, 3);
  } finally { await worker.stop(); }
});

test('retry exhaustion fails honestly rather than reporting completion', async () => {
  const created = await job({ transientFailures: 2 }, { maxRetries: 0 });
  const worker = await startWorker(controller);
  try {
    const failed = await waitFor(() => inspect(created.id), state => state.status === 'failed');
    assert.equal(failed.reason, 'retries_exhausted');
    assert.equal((await effects(created.id)).length, 1);
    assert.equal(failed.events.some(event => event.type === 'job_completed'), false);
  } finally { await worker.stop(); }
});

test('token and cost budgets stop before over-reserving, and explicit resume preserves completed stages', async () => {
  for (const limits of [{ maxTokens: 10 }, { maxCostMicros: 100 }]) {
    const created = await job({}, limits);
    const worker = await startWorker(controller);
    try {
      const stopped = await waitFor(() => inspect(created.id), state => state.status === 'needs_review');
      assert.equal(stopped.reason, 'budget_exhausted');
      assert.equal(stopped.used_tokens, 10);
      assert.equal(stopped.used_cost_micros, 100);
      assert.equal((await effects(created.id)).length, 1);
      await controller.resume(config.ownerId, created.id, { maxTokens: 100, maxCostMicros: 1000 });
      const done = await waitFor(() => inspect(created.id), state => state.status === 'completed');
      assert.equal(done.generation, 1);
      assert.equal((await effects(created.id)).length, 3);
    } finally { await worker.stop(); }
  }
});

test('cancelling an active attempt revokes publication and stops the handler', async () => {
  const created = await job({ delayMs: 3000 });
  const worker = await startWorker(controller);
  try {
    const running = await waitFor(() => inspect(created.id), state => state.status === 'running');
    await controller.cancel(config.ownerId, created.id);
    await delay(config.leaseMs + 200);
    const cancelled = await inspect(created.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal((await effects(created.id)).length, 0);
    assert.equal(await controller.complete({ id: running.current_attempt_id, jobId: created.id,
      stageId: running.stages[0]!.id, stage: 'prepare', projectId: running.project_id } as Claim, { late: true }), false);
    assert.equal(cancelled.artifacts.length, 0);
  } finally { await worker.stop(); }
});

test('expired leases fence old workers after recovery and a replacement claim', async () => {
  const created = await job();
  const old = (await controller.claim(created.id, randomUUID()))!;
  await delay(config.leaseMs + 200);
  assert.equal(await controller.heartbeat(old), false, 'An expired lease cannot be revived');
  assert.equal(await controller.fail(old, 'handler_error'), false, 'A stale failure cannot change the job');
  await controller.recover();
  const replacement = (await controller.claim(created.id, randomUUID()))!;
  assert.notEqual(old.id, replacement.id);
  assert.equal(await controller.complete(old, { stale: true }), false);
  assert.equal(await controller.complete(replacement, { current: true }), true);
  assert.equal((await effects(created.id)).length, 1);
  await controller.cancel(config.ownerId, created.id);
});

test('stage timeouts stop for review', async () => {
  const created = await job({ delayMs: 1500 }, { stageTimeoutMs: 250 });
  const worker = await startWorker(controller);
  try {
    const result = await waitFor(() => inspect(created.id), state => state.status === 'needs_review');
    assert.equal(result.reason, 'stage_timeout');
    assert.equal((await effects(created.id)).length, 0);
  } finally { await worker.stop(); }
});

test('wall-clock deadlines survive queue boundaries and stop the pipeline', async () => {
  const created = await job({ delayMs: 300 }, { maxRuntimeMs: 500 });
  const worker = await startWorker(controller);
  try {
    const result = await waitFor(() => inspect(created.id), state => state.status === 'needs_review');
    assert.equal(result.reason, 'wall_clock_limit');
    assert((await effects(created.id)).length < 3);
  } finally { await worker.stop(); }
});

test('an actual SIGKILL and replacement worker resume without duplicated effects', async () => {
  const created = await job({ delayMs: 1000 });
  const first = await workerProcess();
  try {
    await waitFor(() => inspect(created.id), state => state.stages[0]?.status === 'completed' && state.current_attempt_id !== null);
    await stopProcess(first, 'SIGKILL');
    const replacement = await workerProcess();
    try {
      const done = await waitFor(() => inspect(created.id), state => state.status === 'completed', 30_000);
      assert.equal((await effects(created.id)).length, 3);
      assert(done.attempts.some(attempt => attempt.status === 'interrupted'));
      assert.equal(done.events.filter(event => event.type === 'job_completed').length, 1);
    } finally { await stopProcess(replacement); }
  } finally { await stopProcess(first); }
});

test('authenticated API validates inputs and hides another owner’s jobs', async () => {
  const server = createApi(controller);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: `Bearer ${config.apiToken}`, 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(base + '/v1/projects')).status, 401);
    assert.equal((await fetch(base + '/v1/health', { headers })).status, 200);
    assert.equal((await fetch(base + '/v1/projects', { method: 'POST', headers, body: JSON.stringify({ name: 'x', ownerId: randomUUID() }) })).status, 400);
    assert.equal((await fetch(base + '/v1/projects', { headers: { ...headers, Origin: 'https://untrusted.example' } })).status, 403);
    assert.equal((await fetch(base + '/v1/projects', { method: 'POST', headers, body: '{' })).status, 400);
    assert.equal((await fetch(base + '/v1/projects', { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
    assert.equal((await fetch(base + '/v1/projects', { method: 'POST', headers, body: JSON.stringify({ name: 'x'.repeat(70000) }) })).status, 413);
    assert.equal((await fetch(base + '/v1/health', { headers })).status, 200);
    const foreign = await job({}, {}, randomUUID());
    assert.equal((await fetch(base + `/v1/jobs/${foreign.id}`, { headers })).status, 404);
    assert.equal((await fetch(base + `/v1/jobs/${foreign.id}/cancel`, { method: 'POST', headers })).status, 404);
    const own = await job();
    assert.equal((await fetch(base + `/v1/jobs/${own.id}`, { headers })).status, 200);
    assert.equal((await fetch(base + `/v1/jobs/${own.id}/cancel`, { method: 'POST', headers })).status, 200);
    assert.equal((await fetch(base + '/v1/jobs', { method: 'POST', headers, body: JSON.stringify({ projectId: randomUUID(), pipeline: 'arbitrary-shell' }) })).status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
