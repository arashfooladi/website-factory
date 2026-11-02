import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {AddressInfo} from 'node:net';
import {Controller} from '../../src/controller.js';
import {Environments} from '../../src/environments.js';
import {Agents} from '../../src/agents.js';
import {parseConfig} from '../../src/config.js';
import {createApi} from '../../src/api.js';
import {AgentWorkspace} from '../../src/agent-workspace.js';
import {AgentTools} from '../../src/agent-tools.js';
import {AgentBrowser} from '../../src/agent-browser.js';
import {AgentArtifacts} from '../../src/agent-artifacts.js';

const exec=promisify(execFile);
const config=parseConfig({...JSON.parse(await readFile('.runtime/controller/config.test.json','utf8')),
  environmentRoot:'.runtime/controller/agent-env-tests',previewPortBase:9500,maxEnvironments:4,agentRoot:'.runtime/controller/agent-tests'});
let controller:Controller,manager:Environments,agents:Agents,environmentId:string;
let api:ReturnType<typeof createApi>,origin:string,first:any;
const headers={authorization:`Bearer ${config.apiToken}`,'content-type':'application/json'};
const limits={maxRuntimeMs:600000,maxObservedTokens:200000,maxToolCalls:18,maxArtifactBytes:33554432};
async function until<T>(read:()=>Promise<T>,ready:(value:T)=>boolean,timeout=660000):Promise<T>{
  const end=Date.now()+timeout;
  while(Date.now()<end){const value=await read();if(ready(value))return value;await new Promise(done=>setTimeout(done,300));}
  throw new Error('test_wait_expired');
}
const inspect=(id:string)=>agents.inspect(config.ownerId,id);
async function finished(id:string){return until(()=>inspect(id),row=>!['queued','running','cancelling'].includes(row.status));}
async function state(status:string){return until(()=>manager.inspect(config.ownerId,environmentId),row=>{
  if(row.status==='failed')throw new Error(`environment_failed:${row.operations.at(-1)?.error_code}`);
  return row.status===status&&!row.current_operation_id;
});}
async function assertCandidate(row:any,width:string){
  assert.equal(row.status,'completed',`Agent failed: ${row.reason}; ${row.summary}`);
  assert.match(row.candidate_revision,/^[a-f0-9]{40}$/);assert.match(row.source_digest,/^[a-f0-9]{64}$/);
  assert.equal(row.releaseEligible,false);assert(row.usage.confirmed);assert(row.usage.totalTokens>0);assert.equal(row.usage.costMicros,null);
  const observation=row.events.findLast((event:any)=>event.type==='final_observation').data.observation;
  assert.equal(observation.summary.httpStatus,200);
  const body=observation.summary.elements.find((element:any)=>element.tag==='body');
  assert.equal(body.style.borderTopWidth,width);assert.equal(body.style.borderTopColor,'rgb(18, 138, 68)');
  const source=row.artifacts.find((item:any)=>item.kind==='candidate_source');assert(source);
  assert.equal(source.candidate_revision,row.candidate_revision);
  const artifact=await agents.artifact(config.ownerId,row.id,source.id);
  assert.equal(createHash('sha256').update(artifact.bytes).digest('hex'),source.sha256);
  const candidate=JSON.parse(artifact.bytes.toString());assert.equal(candidate.sourceDigest,row.source_digest);
  assert(candidate.files['style.css'].includes('FACTORY_AGENT_BORDER'));
  const git=await exec('git',['-C',join(config.agentRoot,'runs',row.id,'candidate'),'rev-parse','HEAD']);
  assert.equal(git.stdout.trim(),row.candidate_revision);
  assert(row.events.some((event:any)=>event.type==='tool_completed'&&event.data.name==='factory_browser'&&event.data.success));
  return observation;
}
before(async()=>{
  assert(new URL(config.databaseUrl).pathname.endsWith('_test'));
  controller=await new Controller(config).open();manager=await new Environments(controller).open();
  const prepared=await readFile('.runtime/controller/agent-test-env.json','utf8').then(JSON.parse).catch(()=>null);
  if(prepared){
    const row=await manager.inspect(config.ownerId,prepared.environmentId).catch(()=>null);
    if(row&&row.status==='running'&&!row.current_operation_id)environmentId=row.id;
  }
  if(!environmentId){
    const project=await controller.createProject(config.ownerId,{name:'Part 4 live agent integration'});
    environmentId=(await manager.create(config.ownerId,{projectId:project.id,limits:{ttlSeconds:7200}})).id;
    await state('stopped');await manager.request(config.ownerId,environmentId,'start');await state('running');
  }
  agents=await new Agents(controller,manager).open();api=createApi(controller,manager,agents);
  await new Promise<void>(done=>api.listen(0,'127.0.0.1',done));origin=`http://127.0.0.1:${(api.address()as AddressInfo).port}`;
});
after(async()=>{
  if(agents)await agents.close();
  if(api){api.closeAllConnections();await new Promise<void>(done=>api.close(()=>done()));}
  if(manager&&environmentId){
    const row=await manager.inspect(config.ownerId,environmentId).catch(()=>null);
    if(row&&row.status!=='deleted'&&!row.current_operation_id){await manager.request(config.ownerId,environmentId,'destroy');await state('deleted');}
  }
  if(manager)await manager.close();if(controller)await controller.close();
});

test('real Codex reads and changes a child theme, sees its browser result and publishes a protected candidate',async()=>{
  const response=await fetch(origin+'/v1/agent-runs',{method:'POST',headers,body:JSON.stringify({environmentId,role:'builder',limits,
    prompt:'Make this one small verification change. Read child/style.css, then append a CSS rule at its end with comment /* FACTORY_AGENT_BORDER */ and body { border-top: 7px solid #128a44 !important; }. Preserve all existing content. Use factory_browser to navigate to / after saving and inspect the rendered result. Report the observed border. Do not change any other file.'})});
  assert.equal(response.status,202);const queued=await response.json()as any;
  first=await finished(queued.id);await assertCandidate(first,'7px');
  await writeFile('.runtime/controller/agent-live-evidence.json',JSON.stringify({firstRunId:first.id,sessionId:first.provider_session_id,candidate:first.candidate_revision,usage:first.usage}),{mode:0o600});
});
test('continuation reuses the real provider session, rechecks current files and records a new candidate',async()=>{
  assert(first?.provider_session_id);
  const next=await agents.resume(config.ownerId,first.id,{limits,prompt:'Continue the verification. Re-read child/style.css. Change only the FACTORY_AGENT_BORDER body rule from 7px to 9px. Preserve the rest of the file. Use factory_browser to reload / and verify the rendered border. Report the result.'});
  const row=await finished(next.id);await assertCandidate(row,'9px');
  assert.equal(row.provider_session_id,first.provider_session_id);assert.equal(row.session_key,first.session_key);
  assert.notEqual(row.provider_turn_id,first.provider_turn_id);assert.notEqual(row.candidate_revision,first.candidate_revision);
  await assert.rejects(agents.resume(config.ownerId,first.id,{limits,prompt:'stale resume'}),/resume_latest_run/);
});
test('role, ownership, API authentication and artifact access enforce the assigned boundary',async()=>{
  assert.equal((await fetch(origin+'/v1/agent-runs/'+first.id)).status,401);
  await assert.rejects(agents.inspect(randomUUID(),first.id),/not_found/);
  await assert.rejects(agents.artifact(randomUUID(),first.id,first.artifacts[0].id),/not_found/);
  const response=await fetch(origin+`/v1/agent-runs/${first.id}/artifacts/${first.artifacts[0].id}`,{headers});
  assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy')!,/default-src 'none'/);
  const store=new AgentArtifacts(join(config.agentRoot,'role-test'),1048576);
  const workspace=new AgentWorkspace(manager,environmentId);
  const tools=new AgentTools(workspace,{}as AgentBrowser,store,false,5,async()=>{});
  assert(!tools.definitions.some(tool=>tool.name==='factory_edit'));
  assert.equal((await tools.invoke('factory_edit',{path:'child/forbidden.txt',content:'blocked'})).success,false);
  await assert.rejects(workspace.edit({path:'parent/style.css',content:'blocked'}),/read_only_parent/);
  await assert.rejects(workspace.read({path:'child/../../secret'}));
});
test('cancelling a live provider turn stops its process group and cannot publish a candidate',async()=>{
  const queued=await agents.create(config.ownerId,{environmentId,role:'analyst',limits,prompt:'Inspect the current child theme files and browser at desktop, 320px mobile and short landscape. Explain what you observed in detail. Do not edit files.'});
  const running=await until(()=>inspect(queued.id),row=>Boolean(row.provider_turn_id)||!['queued','running'].includes(row.status));
  assert.equal(running.status,'running');
  await assert.rejects(manager.request(config.ownerId,environmentId,'stop'),/agent_run_active/);
  await assert.rejects(agents.create(config.ownerId,{environmentId,prompt:'competing'}),/agent_run_active/);
  await agents.cancel(config.ownerId,queued.id);const row=await finished(queued.id);
  assert.equal(row.status,'cancelled');assert.equal(row.reason,'user_cancelled');assert.equal(row.candidate_revision,null);
  assert(!row.artifacts.some((item:any)=>item.kind==='candidate_source'));
  const unit='factory_agent_'+queued.id.replaceAll('-','')+'.service';
  await assert.rejects(exec('systemctl',['--user','is-active','--quiet',unit]));
});
test('an expired worker lease is recovered without accepting its later candidate',async()=>{
  const queued=await agents.create(config.ownerId,{environmentId,role:'analyst',limits,prompt:'Read the child theme and inspect the preview at several viewports; report all observed UI details.'});
  await until(()=>inspect(queued.id),row=>Boolean(row.provider_turn_id));
  await controller.pool.query("UPDATE factory.agent_runs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[queued.id]);
  await agents.recover();const row=await finished(queued.id);
  assert.equal(row.status,'needs_review');assert.equal(row.reason,'worker_interrupted');assert.equal(row.candidate_revision,null);
  assert.equal(row.usage.confirmed,false);assert.equal(row.usage.reservedTokens,limits.maxObservedTokens);
});
