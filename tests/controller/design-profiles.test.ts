import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Controller} from '../../src/controller.js';
import {parseConfig} from '../../src/config.js';
import {DesignProfiles} from '../../src/design-profiles.js';
import {loadAgentInstructions} from '../../src/skills.js';
import type {ProviderAdapter} from '../../src/agent-contracts.js';

const config=parseConfig({...JSON.parse(await readFile('.runtime/controller/config.test.json','utf8')),designRoot:'.runtime/controller/design-profile-tests',agentRoot:'.runtime/controller/design-profile-agent-tests'});
let controller:Controller,profiles:DesignProfiles,mode='valid',held!:()=>void,successfulId:string;
const input={domain:'Counted fixture commerce',prompts:['A fictional towel store with product prices and a useful catalog.','A fictional bike store with parts and a useful catalog.',
  'A fictional notebook store with stationery and prices.','A fictional ceramic store with mugs and bowls and prices.'],comparisonPrompt:'A fictional desk lamp store with product prices and a useful catalog.',maxObservedTokens:30000,maxRuntimeMs:180000};
const adapter:ProviderAdapter={name:'calibration-fixture-v1',run:async(task,context)=>{
  if(mode==='cancel'){held();await new Promise<void>(done=>context.signal.addEventListener('abort',()=>done(),{once:true}));return{status:'cancelled',sessionId:null,turnId:null,text:'',usage:{inputTokens:1,cachedInputTokens:0,outputTokens:0,totalTokens:1,costMicros:null,confirmed:false}};}
  let deliverable:any;
  if(task.prompt.startsWith('Analyze repeated visual defaults'))deliverable={patterns:[{id:'hero-panel',description:'Every fixture places the heading in the same large bordered hero panel.',avoid:'Avoid the repeated oversized bordered hero panel when the client has not requested it.',
    occurrences:[1,2,3,4].map(index=>({sampleId:'sample-'+index,sourceQuote:mode==='invalid-evidence'?'this source never appeared':'class="hero"'}))}],caveats:['Controlled fixtures are intentionally repetitive and do not measure a real model.']};
  else if(task.prompt.startsWith('Review the held-out comparison'))deliverable={outcome:mode==='inconclusive'?'inconclusive':'improved',patterns:[{patternId:'hero-panel',before:true,after:false,evidence:'The before screenshot shows the bordered full-width hero; the after screenshot has an ordinary heading beside its product list. The class hero is absent in the after HTML.'}],functionalOrLayoutRegressions:[],caveats:['This is a controlled comparison.']};
  else{
    const after=task.prompt.startsWith('Unslop profile');deliverable={html:`<!doctype html><html lang="en"><head><title>Fixture store</title><style>body{margin:24px;font:18px Arial;color:#222;background:#fff}header.hero{border:1px solid #444;padding:40px}a{color:#134e33}</style></head><body><nav><a href="#products">Products</a></nav><header${after?'':' class="hero"'}><h1>Fixture store</h1><p>Illustrative catalog.</p></header><main id="products"><h2>Products</h2><p>Lamp · $46</p><a href="#products">View products</a></main></body></html>`};
  }
  const result=await context.onTool('factory_calibration_submit',deliverable);assert.equal(result.success,!(mode==='invalid-evidence'&&task.prompt.startsWith('Analyze repeated visual defaults')));
  return{status:'completed',sessionId:randomUUID(),turnId:randomUUID(),text:'Submitted.',usage:{inputTokens:10,cachedInputTokens:0,outputTokens:10,totalTokens:20,costMicros:null,confirmed:true}};
}};
async function done(id:string){const end=Date.now()+240000;while(Date.now()<end){const row=await profiles.inspect(config.ownerId,id);if(!['queued','running','cancelling'].includes(row.status))return row;await new Promise(done=>setTimeout(done,200));}throw new Error('profile_test_timeout');}
before(async()=>{assert(new URL(config.databaseUrl).pathname.endsWith('_test'));controller=await new Controller(config).open();profiles=await new DesignProfiles(controller,adapter).open();});
after(async()=>{if(profiles)await profiles.close();if(controller)await controller.close();});
test('Unslop calibration stores actual paired renders, counted source evidence, a held-out review and a hash-pinned usable profile',async()=>{
  const created=await profiles.create(config.ownerId,input);successfulId=created.id;const row=await done(created.id);
  assert.equal(row.status,'completed',row.reason);assert.equal(row.profile.sampleCount,4);assert.equal(row.profile.provisional,true);assert.equal(row.profile.patterns[0].count,4);
  assert.equal(row.profile.samples[0].observations.length,2);assert(row.artifacts.filter((item:any)=>item.kind==='screenshot').length>=12);
  const assigned=await profiles.select(config.ownerId,{skillPacks:['unslop-calibration'],domain:input.domain});assert(assigned);assert.equal(assigned.id,created.id);
  const loaded=await loadAgentInstructions('builder','v2',{skillPacks:['unslop-calibration']},assigned);assert.equal(loaded.skillVersions['unslop-profile'],created.id);
  assert(loaded.instructions.includes('Observed 4/4'));assert.equal((await profiles.select(config.ownerId,{skillPacks:['unslop-calibration'],domain:'Different domain'})),null);
  assert.equal(await profiles.select(config.ownerId,{skillPacks:['unslop'],domain:input.domain}),null);
  await assert.rejects(profiles.inspect(randomUUID(),created.id),/not_found/);
  const skill=await profiles.artifact(config.ownerId,created.id,row.profile.skillArtifactId),file=join(config.designRoot,'profiles',created.id,row.attempt_id,'artifacts',skill.metadata.id);
  try{await writeFile(file,Buffer.concat([skill.bytes,Buffer.from('altered')]));await assert.rejects(profiles.assigned(config.ownerId,created.id),/artifact_hash_mismatch/);}finally{await writeFile(file,skill.bytes);}
});
test('fabricated source evidence cannot publish a calibrated profile',async()=>{
  mode='invalid-evidence';const row=await done((await profiles.create(config.ownerId,input)).id);assert.equal(row.status,'needs_review');assert.equal(row.reason,'calibration_task_failed');assert.equal(row.profile,null);
});
test('an inconclusive before/after comparison is preserved but cannot be selected as an eligible profile',async()=>{
  mode='inconclusive';const row=await done((await profiles.create(config.ownerId,input)).id);assert.equal(row.status,'needs_review');assert.equal(row.reason,'calibration_comparison_inconclusive');
  assert.equal(row.profile.eligible,false);await assert.rejects(profiles.assigned(config.ownerId,row.id),/unslop_profile_not_eligible/);
  assert.equal((await profiles.select(config.ownerId,{skillPacks:['unslop-calibration'],domain:input.domain}))?.id,successfulId);
});
test('cancellation drains a running calibration and leaves no usable profile',async()=>{
  mode='cancel';const started=new Promise<void>(done=>{held=done;});const created=await profiles.create(config.ownerId,input);await started;
  await profiles.cancel(config.ownerId,created.id);const row=await done(created.id);assert.equal(row.status,'cancelled');assert.equal(row.profile,null);assert.equal(row.usage.confirmed,false);
});
