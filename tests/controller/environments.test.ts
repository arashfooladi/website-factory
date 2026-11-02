import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Controller } from '../../src/controller.js';
import { Environments } from '../../src/environments.js';
import { parseConfig } from '../../src/config.js';
import { createApi } from '../../src/api.js';
import { chromium } from '@playwright/test';
import type { AddressInfo } from 'node:net';

const config = parseConfig({ ...JSON.parse(await readFile('.runtime/controller/config.test.json','utf8')),
  environmentRoot: resolve('.runtime/controller/environment-tests'), previewPortBase: 9400, maxEnvironments: 4 });
let controller: Controller;
let manager: Environments;
let alpha: string;
let beta: string;
let api: ReturnType<typeof createApi>;
let apiUrl: string;
const headers = { Authorization: `Bearer ${config.apiToken}`, 'Content-Type': 'application/json' };

async function settled(id: string, status: string, timeout = 660_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const state = await manager.inspect(config.ownerId, id);
    if (state.status === 'failed') throw new Error(`Environment operation failed: ${state.operations.at(-1)?.error_code}`);
    if (state.status === status && !state.current_operation_id) return state;
    await new Promise(done => setTimeout(done, 300));
  }
  throw new Error(`Environment did not reach ${status}`);
}
async function command(id: string, code: string) {
  return (await manager.runtime('exec', id, ['/usr/bin/python3','-c',code])).stdout as string;
}
async function wp(id: string, code: string) {
  return (await manager.runtime('exec', id, ['/tools/php','/tools/wp-cli.phar','--path=/site','eval',code])).stdout.trim() as string;
}
async function secret(id: string) {
  return JSON.parse(await readFile(join(config.environmentRoot,'instances',id,'private.json'),'utf8'));
}
async function preview(id: string, path = '/') {
  const state = await manager.inspect(config.ownerId,id);
  const data = await secret(id);
  return fetch(`http://127.0.0.1:${state.preview_port}${path}`, { headers: { Authorization: `Bearer ${data.previewToken}` } });
}

before(async () => {
  assert(new URL(config.databaseUrl).pathname.endsWith('_test'));
  controller = await new Controller(config).open();
  manager = await new Environments(controller).open();
  api = createApi(controller, manager);
  await new Promise<void>(done => api.listen(0,'127.0.0.1',done));
  apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  const a = await controller.createProject(config.ownerId,{name:'Isolation alpha'});
  const b = await controller.createProject(config.ownerId,{name:'Isolation beta'});
  alpha = (await manager.create(config.ownerId,{projectId:a.id})).id;
  beta = (await manager.create(config.ownerId,{projectId:b.id})).id;
  await settled(alpha,'stopped'); await settled(beta,'stopped');
  await manager.request(config.ownerId,alpha,'start');
  await settled(alpha,'running');
  await manager.request(config.ownerId,beta,'start');
  await settled(beta,'running');
});

after(async () => {
  if (manager) {
    for (const id of [alpha,beta].filter(Boolean)) {
      const state = await manager.inspect(config.ownerId,id).catch(() => null);
      if (state && state.status !== 'deleted' && !state.current_operation_id) {
        await manager.request(config.ownerId,id,'destroy');
        await settled(id,'deleted');
      }
    }
    if (api) { api.closeAllConnections(); await new Promise<void>(done => api.close(() => done())); }
    await manager.close();
  }
  if (controller) await controller.close();
  // Report resource types if shutdown lingers; this timer does not keep it alive.
  setTimeout(() => console.error(JSON.stringify({event:'environment_test_shutdown_resources',
    resources:process.getActiveResourcesInfo()})),10_000).unref();
});

test('two WordPress environments serve independently with distinct database identities and credentials', async () => {
  assert.equal((await preview(alpha)).status,200);
  assert.equal((await preview(beta,'/shop/')).status,200);
  assert.equal(await wp(alpha,'echo get_option("factory_environment_id");'),alpha);
  assert.equal(await wp(beta,'echo get_option("factory_environment_id");'),beta);
  assert.notEqual((await manager.credentials(config.ownerId,alpha)).password,(await manager.credentials(config.ownerId,beta)).password);
  await wp(alpha,'update_option("client_marker","alpha");');
  assert.equal(await wp(beta,'echo get_option("client_marker","missing");'),'missing');
  await command(alpha,'from pathlib import Path; Path("/workspace/child-theme/client-marker.txt").write_text("alpha"); Path("/site/wp-content/uploads/client-marker.txt").write_text("alpha-upload")');
  assert.equal((await command(beta,'from pathlib import Path; print(Path("/workspace/child-theme/client-marker.txt").exists())')).trim(),'False');
  assert.equal(await (await preview(alpha,'/wp-content/uploads/client-marker.txt')).text(),'alpha-upload');
  assert.equal(await wp(alpha,'echo wp_mail("sink@example.invalid","Isolation mail test","Captured locally") ? "captured" : "failed";'),'captured');
  assert.equal((await command(alpha,'import json; print(json.loads(open("/logs/mail.jsonl").readlines()[-1])["subject"])')).trim(),'Isolation mail test');
  assert.equal(await wp(alpha,'echo is_wp_error(wp_remote_get("https://example.com")) ? "blocked" : "unexpected";'),'blocked');
});

test('namespace probes enforce read-only parent, writable child, no host access or outbound network', async () => {
  const probe = await manager.probe(config.ownerId,alpha,'website');
  assert.equal(probe.parent_writable,false);
  assert.equal(probe.child_writable,true);
  for (const key of ['host_home_visible','controller_visible','docker_visible','controller_network_reachable','internet_reachable','nested_userns_allowed']) assert.equal(probe[key],false,key);
  const reference = await manager.probe(config.ownerId,alpha,'reference');
  assert.equal(reference.site_visible,false);
  assert.equal(reference.database_visible,false);
  assert.equal(reference.child_writable,false);
  const status = await manager.runtime('status',alpha);
  assert.match(status.resources,/MemoryMax=1073741824/);
  assert.match(status.resources,/TasksMax=128/);
  assert.match(status.resources,/CPUQuotaPerSecUSec=1s/);
  await assert.rejects(command(alpha,'with open("/workspace/oversized", "wb") as f: f.truncate(129*1024*1024)'));
  await command(alpha,'from pathlib import Path; Path("/workspace/oversized").unlink(missing_ok=True)');
});

test('preview authentication and cookie filtering keep other clients and controller tokens out', async () => {
  const a = await manager.inspect(config.ownerId,alpha);
  const sa = await secret(alpha); const sb = await secret(beta);
  const origin = `http://127.0.0.1:${a.preview_port}`;
  assert.equal((await fetch(origin)).status,401);
  assert.equal((await fetch(origin,{headers:{Authorization:`Bearer ${sb.previewToken}`}})).status,401);
  assert.equal((await fetch(origin,{headers:{Authorization:`Bearer ${config.apiToken}`}})).status,401);
  assert.equal((await fetch(origin,{headers:{Authorization:`Bearer ${sa.previewToken}`,Origin:'https://foreign.example'}})).status,403);
  await command(alpha,`from pathlib import Path; Path("/workspace/child-theme/cookies.php").write_text(${JSON.stringify('<?php header("Content-Type: application/json"); echo json_encode($_COOKIE);')})`);
  const otherHash = createHash('md5').update(`http://127.0.0.1:${sb.port}`).digest('hex');
  const response = await fetch(origin+'/wp-content/themes/client-child/cookies.php',{headers:{Authorization:`Bearer ${sa.previewToken}`,
    Cookie:`factory_preview_other=${sb.previewToken}; wordpress_logged_in_${otherHash}=foreign-session`}});
  assert.deepEqual(await response.json(),[]);
  // Cold WordPress administration can legitimately take more than ten seconds.
  await command(alpha,`from pathlib import Path; Path("/workspace/child-theme/slow.php").write_text(${JSON.stringify('<?php file_put_contents("/workspace/slow-started", "1"); sleep(11); echo "slow-response-ok";')})`);
  const pending = preview(alpha,'/wp-content/themes/client-child/slow.php');
  await command(alpha,'import time\nfrom pathlib import Path\nfor _ in range(100):\n if Path("/workspace/slow-started").exists(): break\n time.sleep(0.05)\nelse: raise RuntimeError("slow request did not start")');
  const parallel = await fetch(origin+'/wp-content/uploads/client-marker.txt',{
    headers:{Authorization:`Bearer ${sa.previewToken}`},signal:AbortSignal.timeout(5000)});
  assert.equal(await parallel.text(),'alpha-upload');
  const slow = await pending;
  assert.equal(slow.status,200);
  assert.equal(await slow.text(),'slow-response-ok');
});

test('a browser can open the protected preview and log into its WordPress administration', async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium'});
  try {
    const context = await browser.newContext({viewport:{width:390,height:844}});
    const page = await context.newPage();
    await page.route('**/*', route => new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    const state = await manager.inspect(config.ownerId,beta);
    const credentials = await manager.credentials(config.ownerId,beta);
    await page.goto(state.previewUrl!);
    await page.waitForURL(`http://127.0.0.1:${state.preview_port}/`);
    assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
    await page.goto(`http://127.0.0.1:${state.preview_port}/wp-login.php`);
    await page.locator('#user_login').fill(credentials.username);
    await page.locator('#user_pass').fill(credentials.password);
    await page.locator('#wp-submit').click();
    await page.waitForURL('**/wp-admin/**');
    const products = await page.goto(`http://127.0.0.1:${state.preview_port}/wp-admin/edit.php?post_type=product`);
    assert.equal(products?.status(),200);
    assert.match(await page.locator('#wpbody-content').innerText(),/محصول ساده آزمایشی/);
    await page.screenshot({path:'.runtime/controller/environment-preview.png',fullPage:true});
  } finally { await browser.close(); }
});

test('the manager recovers protected previews after restart while isolated services keep running', async () => {
  await manager.close();
  await manager.open();
  assert.equal((await preview(alpha)).status,200);
  assert.equal((await preview(beta,'/shop/')).status,200);
  assert.equal(await wp(beta,'echo get_option("factory_environment_id");'),beta);
});

test('stopped snapshots restore files and database while a second environment remains live', async () => {
  await manager.request(config.ownerId,alpha,'stop'); await settled(alpha,'stopped');
  await manager.request(config.ownerId,alpha,'snapshot');
  const snapshot = (await settled(alpha,'stopped')).snapshots.at(-1)!;
  await manager.request(config.ownerId,alpha,'start'); await settled(alpha,'running');
  await wp(alpha,'update_option("client_marker","changed");');
  await command(alpha,'from pathlib import Path; Path("/workspace/child-theme/client-marker.txt").write_text("changed")');
  await manager.request(config.ownerId,alpha,'stop'); await settled(alpha,'stopped');
  await manager.request(config.ownerId,alpha,'restore',snapshot.id); await settled(alpha,'stopped');
  await manager.request(config.ownerId,alpha,'start'); await settled(alpha,'running');
  assert.equal(await wp(alpha,'echo get_option("client_marker");'),'alpha');
  assert.equal((await command(alpha,'from pathlib import Path; print(Path("/workspace/child-theme/client-marker.txt").read_text())')).trim(),'alpha');
  assert.equal((await preview(beta)).status,200);
});

test('environment ownership and path validation apply to lifecycle operations', async () => {
  const foreign = randomUUID();
  await assert.rejects(manager.inspect(foreign,alpha),/not_found/);
  await assert.rejects(manager.request(foreign,alpha,'destroy'),/not_found/);
  assert.equal((await fetch(apiUrl+`/v1/environments/${alpha}`)).status,401);
  assert.equal((await fetch(apiUrl+'/v1/environments',{method:'POST',headers,body:JSON.stringify({projectId:randomUUID(),root:'/etc'})})).status,400);
  await assert.rejects(manager.runtime('status','../../controller'));
});

test('expiry and disk monitoring stop only the affected environment; retention deletes it safely', async () => {
  await controller.pool.query("UPDATE factory.environments SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[alpha]);
  await manager.monitor(); await settled(alpha,'stopped');
  assert.equal((await manager.inspect(config.ownerId,alpha)).reason,'ttl_expired');
  await manager.request(config.ownerId,alpha,'start'); await settled(alpha,'running');
  await command(alpha,'from pathlib import Path\nfor i in range(12):\n with open("/workspace/quota-"+str(i),"wb") as f: f.truncate(100*1024*1024)');
  await manager.monitor(); await settled(alpha,'stopped');
  assert.equal((await manager.inspect(config.ownerId,alpha)).reason,'disk_limit');
  assert.equal((await preview(beta)).status,200);
  await controller.pool.query("UPDATE factory.environments SET retain_until=clock_timestamp()-interval '1 second' WHERE id=$1",[alpha]);
  await manager.monitor(); await settled(alpha,'deleted');
  await assert.rejects(access(join(config.environmentRoot,'instances',alpha)));
  assert.equal(await wp(beta,'echo get_option("factory_environment_id");'),beta);
  assert.equal((await preview(beta,'/shop/')).status,200);
});
