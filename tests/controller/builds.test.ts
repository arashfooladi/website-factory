import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Controller} from '../../src/controller.js';
import {parseConfig} from '../../src/config.js';
import {Intakes} from '../../src/intakes.js';
import {Environments} from '../../src/environments.js';
import {Agents} from '../../src/agents.js';
import {Builds} from '../../src/builds.js';

const config=parseConfig({...JSON.parse(await readFile('.runtime/controller/config.test.json','utf8')),referenceRoot:'.runtime/controller/build-controller-references',buildRoot:'.runtime/controller/build-controller-tests'});
let controller:Controller,intakes:Intakes,agents:Agents,builds:Builds,projectId:string,intakeId:string;
const content={siteTitle:'Client prototype fixture',synthetic:true,pages:[{path:'/',title:'Home',kind:'home'},{path:'/shop/',title:'Shop',kind:'shop'},{path:'/cart/',title:'Cart',kind:'cart'},{path:'/checkout/',title:'Checkout',kind:'checkout'}],
  products:[{key:'linen-towel',name:'Linen towel',price:'18.00',stock:7}]};
async function until<T>(read:()=>Promise<T>,ready:(value:T)=>boolean){const end=Date.now()+60000;while(Date.now()<end){const value=await read();if(ready(value))return value;await new Promise(done=>setTimeout(done,150));}throw new Error('build_controller_test_timeout');}
const inspect=(id:string)=>builds.inspect(config.ownerId,id);
before(async()=>{
  assert(new URL(config.databaseUrl).pathname.endsWith('_test'));controller=await new Controller(config).open();intakes=await new Intakes(controller).open();
  projectId=(await controller.createProject(config.ownerId,{name:'Build controller integrity fixture'})).id;
  const intake=await intakes.create(config.ownerId,{projectId,mode:'custom',prompt:'A complete useful catalog with the supplied client identity.',design:{skillPacks:['factory-design']}});
  const row=await until(()=>intakes.inspect(config.ownerId,intake.id),row=>row.status==='completed');intakeId=row.id;
  agents=new Agents(controller,new Environments(controller));
  // Deliberately no coding-agent worker: the durable build must wait for its child, then drain it on cancellation.
  await controller.boss.createQueue('factory-agent-v1');builds=await new Builds(controller,new Environments(controller),agents).open();
});
after(async()=>{if(builds)await builds.close();if(intakes)await intakes.close();if(controller)await controller.close();});
test('a durable build pins its intake/theme and creates one idempotent child-design operation across a reconciler restart',async()=>{
  const created=await builds.create(config.ownerId,{intakeId,content});const row=await until(()=>inspect(created.id),row=>Boolean(row.design_run_id));
  assert.equal(row.status,'designing');assert.equal(row.releaseEligible,false);assert.equal(row.intake_id,intakeId);assert(row.theme_bundle_id);assert.equal(row.skillset_version,config.skillsetVersion);
  const child=await agents.inspect(config.ownerId,row.design_run_id);assert.equal(child.role,'designer');assert.equal(child.intake_id,intakeId);assert.equal(child.build_id,row.id);assert.equal(child.build_step,'design');
  await assert.rejects(builds.create(config.ownerId,{intakeId,content}),/build_active/);await assert.rejects(builds.inspect(randomUUID(),created.id),/not_found/);
  await builds.close();builds=await new Builds(controller,new Environments(controller),agents).open();
  const replay=await agents.create(config.ownerId,{projectId,intakeId,role:'designer',prompt:'The same operation replay.',limits:{}},undefined,{buildId:created.id,step:'design'});
  assert.equal(replay.id,child.id);assert.equal(Number((await controller.pool.query('SELECT count(*) FROM factory.agent_runs WHERE build_id=$1',[created.id])).rows[0].count),1);
  await builds.cancel(config.ownerId,created.id);const cancelled=await until(()=>inspect(created.id),row=>row.status==='cancelled');
  assert.equal((await agents.inspect(config.ownerId,child.id)).status,'cancelled');assert.equal(cancelled.candidate_revision,null);assert.equal(cancelled.releaseEligible,false);
});
test('unknown child usage is held for review and cannot silently allocate the next model stage',async()=>{
  const created=await builds.create(config.ownerId,{intakeId,content});const row=await until(()=>inspect(created.id),row=>Boolean(row.design_run_id));
  await controller.pool.query("UPDATE factory.agent_runs SET status='needs_review',usage=$2,reason='worker_interrupted' WHERE id=$1",[row.design_run_id,{confirmed:false,totalTokens:0}]);
  const held=await until(()=>inspect(created.id),row=>row.status==='needs_review');assert.equal(held.reason,'build_usage_unconfirmed');assert.equal(held.usage_confirmed,false);assert.equal(held.environment_id,null);assert.equal(held.builder_run_id,null);
});
test('altered build input cannot publish progress or create an agent child',async()=>{
  await builds.close();const created=await builds.create(config.ownerId,{intakeId,content});
  await controller.pool.query("UPDATE factory.build_runs SET input=jsonb_set(input,'{content,siteTitle}','\"Unexpected mutation\"') WHERE id=$1",[created.id]);
  builds=await new Builds(controller,new Environments(controller),agents).open();const held=await until(()=>inspect(created.id),row=>row.status==='needs_review');
  assert.equal(held.reason,'build_input_hash_mismatch');assert.equal(held.design_run_id,null);assert.equal(held.candidate_revision,null);
});
test('required pages, commerce data and design ownership are checked before starting a build',async()=>{
  await assert.rejects(builds.create(config.ownerId,{intakeId,content:{...content,pages:[content.pages[0]]}}),/build_commerce_page_missing/);
  await assert.rejects(builds.create(config.ownerId,{intakeId,content:{...content,products:[]}}),/build_catalog_required/);
  await assert.rejects(builds.create(config.ownerId,{intakeId,content,designId:randomUUID()}),/design_record_unavailable/);
  await assert.rejects(builds.create(randomUUID(),{intakeId,content}),/not_found/);
  const missingAccount=await intakes.create(config.ownerId,{projectId,mode:'custom',prompt:'A catalog with client accounts.',features:['commerce','accounts']});
  await until(()=>intakes.inspect(config.ownerId,missingAccount.id),row=>row.status==='completed');
  await assert.rejects(builds.create(config.ownerId,{intakeId:missingAccount.id,content}),/build_account_page_missing/);
  const unsupported=await intakes.create(config.ownerId,{projectId,mode:'custom',prompt:'A contact form needs a supported form integration.',features:['contact-form']});
  await until(()=>intakes.inspect(config.ownerId,unsupported.id),row=>row.status==='completed');
  await assert.rejects(builds.create(config.ownerId,{intakeId:unsupported.id,content}),/build_feature_not_supported/);
});
