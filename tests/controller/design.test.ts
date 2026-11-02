import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {Controller} from '../../src/controller.js';
import {Environments} from '../../src/environments.js';
import {Agents} from '../../src/agents.js';
import {parseConfig} from '../../src/config.js';
import {AgentReference} from '../../src/agent-reference.js';
import {validateDesign,contrast} from '../../src/design.js';
import {loadAgentInstructions} from '../../src/skills.js';
import type {AgentTask,ProviderAdapter,ProviderOutcome} from '../../src/agent-contracts.js';
import {designFixture} from './design-fixture.js';

const config=parseConfig({...JSON.parse(await readFile('.runtime/controller/config.test.json','utf8')),skillsetVersion:'v1',referenceRoot:'.runtime/controller/reference-tests',agentRoot:'.runtime/controller/design-tests'});
let controller:Controller,agents:Agents,reference:AgentReference,projectId:string,intakeId:string,mode='valid',captured:AgentTask|undefined,submitted!:()=>void;
const limits={maxRuntimeMs:60000,maxObservedTokens:30000,maxToolCalls:10,maxArtifactBytes:8388608};
const adapter:ProviderAdapter={name:'design-fixture-v1',run:async(task,context)=>{
  captured=task;
  const outcome:ProviderOutcome={status:'completed',sessionId:randomUUID(),turnId:randomUUID(),text:'Design fixture finished.',usage:{inputTokens:10,cachedInputTokens:0,outputTokens:10,totalTokens:20,costMicros:null,confirmed:true}};
  if(mode==='missing')return outcome;
  const response=await context.onTool('factory_reference',{action:'overview'});
  assert.equal(response.contentItems[0]?.type,'inputText');
  const overview=JSON.parse((response.contentItems[0]as{type:string;text:string}).text);
  const document=designFixture(overview);document.acceptanceHash=reference.context().acceptanceHash;
  const denied=await context.onTool('factory_edit',{path:'child/forbidden.css',content:'x'});assert.equal(denied.success,false);
  const submission=await context.onTool('factory_design',document);assert.equal(submission.success,true);
  if(mode==='cancel'){
    submitted();await new Promise<void>(done=>context.signal.addEventListener('abort',()=>done(),{once:true}));
  }
  return outcome;
}};
async function done(id:string){const end=Date.now()+90000;while(Date.now()<end){const row=await agents.inspect(config.ownerId,id);if(!['queued','running','cancelling'].includes(row.status))return row;await new Promise(done=>setTimeout(done,100));}throw new Error('design_test_timeout');}
before(async()=>{
  controller=await new Controller(config).open();const fixture=JSON.parse(await readFile('.runtime/controller/reference-integration-evidence.json','utf8'));intakeId=fixture.id;
  projectId=(await controller.pool.query('SELECT project_id FROM factory.intakes WHERE id=$1',[intakeId])).rows[0].project_id;
  reference=await new AgentReference(controller,projectId,intakeId).open();agents=await new Agents(controller,new Environments(controller),adapter).open();
});
after(async()=>{if(agents)await agents.close();if(controller)await controller.close();});
test('design validation rejects missing requirements, fabricated evidence, unsafe paths and unreadable tokens',()=>{
  const document=designFixture(reference.overview());document.acceptanceHash=reference.context().acceptanceHash;
  assert.equal(contrast('#000000','#ffffff'),21);assert(validateDesign(document,reference.context()));
  const assetEvidence=structuredClone(document);assetEvidence.observations.push({statement:'The client supplied an identity asset.',evidenceIds:reference.overview().brief.assetIds});
  assert(validateDesign(assetEvidence,reference.context()));
  for(const [mutate,error]of [
    [(item:any)=>item.pages.pop(),/design_required_page_missing/],
    [(item:any)=>item.observations[0].evidenceIds=[randomUUID()],/design_unknown_evidence/],
    [(item:any)=>item.tokens.colors.text=item.tokens.colors.surface,/design_text_contrast_insufficient/],
    [(item:any)=>item.implementation.checks.pop(),/design_required_checks_missing/],
    [(item:any)=>item.unknowns.pop(),/design_reference_unknowns_missing/],
    [(item:any)=>item.acceptanceHash='0'.repeat(64),/design_reference_mismatch/],
    [(item:any)=>item.implementation.files[0].path='child/../../release.json',/./],
  ]as Array<[(item:any)=>void,RegExp]>){const changed=structuredClone(document);mutate(changed);assert.throws(()=>validateDesign(changed,reference.context()),error);}
});
test('a reference-only designer gets versioned skills and publishes a protected DESIGN.md without a website workspace',async()=>{
  mode='valid';const run=await agents.create(config.ownerId,{projectId,intakeId,role:'designer',prompt:'Produce a concrete design plan.',limits});const row=await done(run.id);
  assert.equal(row.status,'completed',row.reason);assert.equal(row.environment_id,null);assert.equal(row.browser_id,null);assert.equal(row.candidate_revision,null);assert(row.design_record_id);
  assert(captured);assert(!captured.tools.some(tool=>['factory_edit','factory_browser','factory_read'].includes(tool.name)));
  const loaded=await loadAgentInstructions('designer','v1');assert.equal(captured.instructionsHash,loaded.instructionsHash);assert.equal(row.instructions_sha256,loaded.instructionsHash);
  assert.equal(row.skill_versions['factory-design'],'1.0.0');assert.equal(row.skill_versions['factory-design_sha256'],loaded.skillVersions['factory-design_sha256']);
  assert.equal(row.artifacts.find((item:any)=>item.kind==='agent_instructions').sha256,row.instructions_sha256);
  assert(row.artifacts.some((item:any)=>item.kind==='agent_capabilities'));
  const metadata=(await controller.pool.query('SELECT * FROM factory.design_records WHERE id=$1',[row.design_record_id])).rows[0];assert.equal(metadata.intake_id,intakeId);
  const markdown=await agents.artifact(config.ownerId,row.id,metadata.markdown_artifact_id);assert(markdown.bytes.toString().includes('## MainTheme implementation'));
  assert.equal(await readFile(join(config.agentRoot,'runs',row.id,'design','DESIGN.md'),'utf8'),markdown.bytes.toString());
});
test('client fonts and palette are enforced and custom pages do not invent reference evidence',()=>{
  const context=structuredClone(reference.context()),overview=reference.overview(),document=designFixture(overview);
  context.specification.brief.design={fonts:['Vazirmatn'],palette:{accent:'#254b36'}};
  assert.equal(validateDesign(document,context).tokens.bodyFont,'Vazirmatn');
  const wrongFont=structuredClone(document);wrongFont.tokens.headingFont='Arial';assert.throws(()=>validateDesign(wrongFont,context),/design_client_font_mismatch/);
  const wrongPalette=structuredClone(document);wrongPalette.tokens.colors.accent='#334455';assert.throws(()=>validateDesign(wrongPalette,context),/design_client_palette_mismatch/);
  context.specification.brief.mode='custom';context.specification.reference.states=[];document.pages.forEach(page=>page.referenceStateIds=[]);document.observations=[];
  assert.equal(validateDesign(document,context).observations.length,0);
  context.specification.brief.design.pages=[{path:'/',mode:'replica'}];assert.throws(()=>validateDesign(document,context),/design_reference_state_required/);
});
test('provider prose without a valid design submission is held for review',async()=>{
  mode='missing';const run=await agents.create(config.ownerId,{projectId,intakeId,role:'designer',prompt:'Test missing submission.',limits});const row=await done(run.id);
  assert.equal(row.status,'needs_review');assert.equal(row.reason,'design_submission_missing');assert.equal(row.design_record_id,null);
});
test('cancellation cannot publish a submitted draft even when the adapter returns completed',async()=>{
  mode='cancel';const ready=new Promise<void>(done=>{submitted=done;});
  const run=await agents.create(config.ownerId,{projectId,intakeId,role:'designer',prompt:'Test cancellation after submission.',limits});await ready;
  await agents.cancel(config.ownerId,run.id);const row=await done(run.id);
  assert.equal(row.status,'cancelled');assert.equal(row.design_record_id,null);assert(!row.artifacts.some((item:any)=>item.kind==='design_record'));
});
