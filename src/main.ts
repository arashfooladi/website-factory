import { loadConfig } from './config.js';
import { Controller } from './controller.js';
import { createApi } from './api.js';
import { startWorker } from './worker.js';
import { Environments } from './environments.js';
import { Agents } from './agents.js';
import { Intakes } from './intakes.js';
import {Themes} from './themes.js';
import {DesignProfiles} from './design-profiles.js';
import {Builds} from './builds.js';
import {VisualReviewJobs} from './visual-jobs.js';
import {visualProcessor} from './visual-processor.js';
import {CodexAdapter} from './codex-adapter.js';

async function main() {
  const mode = process.argv[2];
  if (!['serve', 'worker', 'migrate'].includes(mode ?? '')) throw new Error('Expected serve, worker or migrate');
  const controller = await new Controller(await loadConfig()).open();
  if (mode === 'migrate') { await controller.close(); return; }
  const environments = mode === 'serve' ? await new Environments(controller).open() : null;
  const themes=environments?await new Themes(controller,environments).open():null;
  const profiles=mode==='serve'?await new DesignProfiles(controller).open():null;
  const agents=environments?await new Agents(controller,environments).open():null;
  const intakes=mode==='serve'?await new Intakes(controller).open():null;
  const builds=environments&&agents?await new Builds(controller,environments,agents).open():null;
  const visual=environments?await new VisualReviewJobs(controller,visualProcessor(controller,environments,new CodexAdapter(controller.config))).open():null;
  const server = mode === 'serve' ? createApi(controller, environments!,agents!,intakes!,themes!,profiles!,builds!,visual!) : null;
  const worker = mode === 'worker' ? await startWorker(controller) : null;
  if (server) await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(controller.config.port, controller.config.host, resolve);
  });
  console.log(JSON.stringify({ event: mode === 'serve' ? 'controller_listening' : 'worker_ready',
    ...(server ? { host: controller.config.host, port: controller.config.port } : { workerId: worker?.workerId }) }));
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    if (server) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); });
    if(intakes)await intakes.close();
    if(visual)await visual.close();
    if(builds)await builds.close();
    if(themes)await themes.close();
    if(profiles)await profiles.close();
    if(agents)await agents.close();
    if (environments) await environments.close();
    if (worker) await worker.stop();
    await controller.close();
  };
  process.on('SIGTERM', () => { void stop().catch(() => process.exitCode = 1); });
  process.on('SIGINT', () => { void stop().catch(() => process.exitCode = 1); });
}
main().catch(() => {
  console.error(JSON.stringify({ event: 'startup_failed', hint: 'Check private configuration and database readiness.' }));
  process.exit(1);
});
