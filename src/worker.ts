import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Controller, type Claim } from './controller.js';

type AbortReason = 'lease_lost' | 'worker_shutdown' | 'stage_timeout';
class StageFailure extends Error {}

export async function startWorker(controller: Controller) {
  const workerId = randomUUID();
  const active = new Set<AbortController>();
  let closing = false;
  let recovering: Promise<unknown> | null = null;
  const recover = () => {
    if (recovering || closing) return;
    recovering = controller.recover().catch(() => {
      console.error(JSON.stringify({ event: 'recovery_error' }));
    }).finally(() => { recovering = null; });
  };
  recover();
  const reaper = setInterval(recover, controller.config.pollMs);
  const registration = await controller.registerWorker(async jobId => {
    if (closing) return;
    const claim: Claim | null = await controller.claim(jobId, workerId);
    if (!claim) return;
    const abort = new AbortController();
    active.add(abort);
    let stopped = false;
    let heartbeat: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => abort.abort('stage_timeout' satisfies AbortReason),
      Math.max(1, claim.deadline.getTime() - Date.now()));
    const renew = async () => {
      if (stopped || abort.signal.aborted) return;
      const started = Date.now();
      try {
        const valid = await controller.heartbeat(claim);
        if (stopped || abort.signal.aborted) return;
        if (!valid) {
          console.error(JSON.stringify({ event: 'lease_lost', attemptId: claim.id, heartbeatMs: Date.now() - started }));
          abort.abort(Date.now() >= claim.deadline.getTime() ? 'stage_timeout' : 'lease_lost');
        }
        else if (Date.now() - started > controller.config.leaseMs / 2) console.error(JSON.stringify({ event: 'slow_heartbeat', attemptId: claim.id, heartbeatMs: Date.now() - started }));
      } catch { console.error(JSON.stringify({ event: 'heartbeat_error', attemptId: claim.id })); abort.abort('lease_lost'); }
      finally {
        if (!stopped && !abort.signal.aborted) heartbeat = setTimeout(() => { void renew(); },
          Math.max(0, Math.floor(controller.config.leaseMs / 3) - (Date.now() - started)));
      }
    };
    // Renew immediately, then account for query latency rather than skipping
    // interval ticks while a previous heartbeat is still committing.
    void renew();
    console.log(JSON.stringify({ event: 'attempt_started', workerId, jobId, stage: claim.stage, attemptId: claim.id }));
    try {
      // This trusted demo handler has no shell, network, production or credential access.
      // Actual provider adapters and isolated processes arrive in later parts.
      await delay(claim.input.delayMs, undefined, { signal: abort.signal });
      if (claim.stage === 'checkpoint' && claim.number <= claim.input.transientFailures) throw new StageFailure('transient_error');
      if (!abort.signal.aborted) await controller.complete(claim,
        { pipeline: 'controller-smoke-v1', jobId, stage: claim.stage, projectId: claim.projectId });
    } catch (error) {
      const reason: AbortReason | undefined = abort.signal.reason;
      if (reason === 'stage_timeout' || reason === 'worker_shutdown') await controller.fail(claim, reason);
      else if (reason !== 'lease_lost') await controller.fail(claim, error instanceof StageFailure ? 'transient_error' : 'handler_error');
    } finally {
      clearTimeout(timer);
      stopped = true;
      clearTimeout(heartbeat);
      active.delete(abort);
    }
  });
  return {
    workerId,
    async stop() {
      closing = true;
      clearInterval(reaper);
      for (const abort of active) abort.abort('worker_shutdown' satisfies AbortReason);
      if (recovering) await recovering;
      await controller.unregisterWorker(registration);
    },
  };
}
