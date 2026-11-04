import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {VisualFidelity,type FidelitySource} from '../../src/visual-fidelity.js';
import {VisualReviewEvidence} from '../../src/visual-review.js';
import {AgentArtifacts} from '../../src/agent-artifacts.js';
import {assessVisualCaptures} from '../../src/visual-assessment.js';
import type {ProviderAdapter,ToolResponse,ProviderUsage} from '../../src/agent-contracts.js';

const paired=async():Promise<ToolResponse>=>({success:true,contentItems:[{type:'inputText',text:'Paired immutable reference HTML/layout.'},{type:'inputImage',imageUrl:'data:image/png;base64,fixture'}]});
function fixture(){
 const captures:Array<{path:string;viewport:{name:string;width:number;height:number};structureId:string;screenshotId:string;htmlId:string}>=['desktop','mobile'].map(name=>({path:'/',viewport:{name,width:name==='mobile'?390:1280,height:900},structureId:randomUUID(),screenshotId:randomUUID(),htmlId:randomUUID()}));
 const source:FidelitySource={brief:{mode:'replica',referenceUrls:['https://reference.example/'],pages:[{path:'/'}]},states:captures.map(c=>({stateId:randomUUID(),path:'https://reference.example/',requestedUrl:'https://reference.example/',purpose:'route-initial',viewport:c.viewport,summary:{httpStatus:200},screenshot:{id:randomUUID()},html:{id:randomUUID()},structure:{id:randomUUID()}}))};
 return{captures,source};
}
function comparisons(plan:VisualFidelity,verdict:'satisfied'|'defect'|'unverified'='satisfied'){
 return plan.slots.flatMap(slot=>slot.axes.map(axis=>({captureId:slot.captureId,axis,...(slot.reference?{referenceStateId:slot.reference.stateId}:{}),verdict,detail:'Concrete comparison of this visual axis with the assigned immutable reference.'})));
}

test('fidelity honors per-page modes and axes without demanding copies of free design choices',()=>{
 const {captures,source}=fixture();
 assert.equal(comparisons(new VisualFidelity('/',captures,source,paired)).length,8);
 source.brief.mode='semi-replica';let plan=new VisualFidelity('/',captures,source,paired);assert.equal(plan.policy.axes.layout,'match');assert.equal(plan.policy.axes.typography,'adapt');
 source.brief.mode='inspiration';plan=new VisualFidelity('/',captures,source,paired);assert.equal(plan.policy.axes.layout,'free');assert.deepEqual(plan.slots[0]!.axes,['palette','imagery']);
 source.brief.mode='custom';plan=new VisualFidelity('/',captures,source,paired);assert.equal(plan.validate([],new Set(),new Set(),[]).status,'not-applicable');
 source.brief.design={pages:[{path:'/',mode:'replica',axes:{palette:'free'}}]};plan=new VisualFidelity('/',captures,source,paired);assert.equal(plan.policy.mode,'replica');assert(!plan.slots[0]!.axes.includes('palette'));
});

test('comparison claims require viewed assigned evidence, complete slots and matching defect findings',async()=>{
 const {captures,source}=fixture(),plan=new VisualFidelity('/',captures,source,paired),seen=new Set(captures.map(c=>c.structureId));
 assert.throws(()=>plan.validate(comparisons(plan),seen,seen,[]),/fidelity_evidence_not_viewed/);
 await assert.rejects(plan.view({stateIds:[randomUUID()]}),/fidelity_reference_denied/);
 await plan.view({stateIds:source.states.map(s=>s.stateId)});
 assert.throws(()=>plan.validate(comparisons(plan),seen,new Set(),[]),/fidelity_evidence_not_viewed/);
 assert.throws(()=>plan.validate(comparisons(plan).slice(1),seen,seen,[]),/fidelity_comparison_coverage_invalid/);
 assert.throws(()=>plan.validate([...comparisons(plan),comparisons(plan)[0]!],seen,seen,[]),/fidelity_comparison_slot_invalid/);
 assert.throws(()=>plan.validate(comparisons(plan).map(c=>({...c,referenceStateId:randomUUID()})),seen,seen,[]),/fidelity_reference_mismatch/);
 assert.throws(()=>plan.validate(comparisons(plan,'defect'),seen,seen,[]),/fidelity_defect_finding_required/);
 const result=plan.validate(comparisons(plan,'defect'),seen,seen,captures.map(c=>({captureId:c.structureId,category:'reference-fidelity'})));
 assert.equal(result.complete,true);assert.equal(result.requiresRepair,true);assert.equal(result.interactionsVerified,false);assert.equal(result.releaseEligible,false);
 assert.equal(plan.validate(comparisons(plan,'unverified'),new Set(),new Set(),[]).complete,false);
});

test('missing/ambiguous references and synthetic or incomplete candidate matrices cannot certify fidelity',()=>{
 const {captures,source}=fixture();source.states=[];
 let plan=new VisualFidelity('/',captures,source,paired);assert.equal(plan.slots[0]!.reference,null);assert.equal(plan.validate(comparisons(plan,'unverified'),new Set(),new Set(),[]).status,'incomplete');
 source.brief.referenceUrls.push('https://other.example/');plan=new VisualFidelity('/',captures,source,paired);assert.equal(plan.mappingBasis,'unmapped');
 source.brief.pages[0]!.referenceUrl='https://explicit.example/';plan=new VisualFidelity('/',captures,source,paired);assert.equal(plan.referenceUrl,'https://explicit.example/');
 assert.throws(()=>new VisualFidelity('/',captures.slice(1),source,paired),/fidelity_candidate_matrix_incomplete/);
 assert.throws(()=>new VisualFidelity('/',captures.map(c=>({...c,scenario:'synthetic-content'})),source,paired),/fidelity_candidate_matrix_incomplete/);
 const complete=fixture();complete.source.states.push({...complete.source.states[0],stateId:randomUUID()});plan=new VisualFidelity('/',complete.captures,complete.source,paired);assert.equal(plan.slots[0]!.reference,null);
 const redirected=fixture();redirected.source.states[0].path='https://reference.example/canonical/';assert(new VisualFidelity('/',redirected.captures,redirected.source,paired).slots[0]!.reference);
});

test('a failed reference batch cannot grant viewed credit for an image never delivered to the reviewer',async()=>{
 const {captures,source}=fixture(),seen=new Set(captures.map(c=>c.structureId));
 const plan=new VisualFidelity('/',captures,source,async args=>{
  if((args as any).stateId===source.states[1].stateId)throw new Error('reference_artifact_hash_mismatch');return paired();
 });
 await assert.rejects(plan.view({stateIds:source.states.map(s=>s.stateId)}),/reference_artifact_hash_mismatch/);
 const records=comparisons(plan).map(c=>c.captureId===captures[1]!.structureId?{...c,verdict:'unverified'}:c);
 assert.throws(()=>plan.validate(records,seen,seen,[]),/fidelity_evidence_not_viewed/);
});

test('provider comparison tools and review submission preserve both sides of the evidence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'factory-fidelity-'));
 try{
  const artifacts=new AgentArtifacts(root,2097152),{captures,source}=fixture();
  for(const c of captures){c.screenshotId=(await artifacts.save('screenshot','image/png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNkoAAAAASUVORK5CYII=','base64'))).id;c.htmlId=(await artifacts.save('html','text/html','<main>Candidate</main>')).id;c.structureId=(await artifacts.save('structure','application/json','{}')).id;}
  const report={candidateRevision:'a'.repeat(40),sourceDigest:'b'.repeat(64),coverage:{complete:true},captures};
  const plan=new VisualFidelity('/',captures,source,paired),base={candidateRevision:report.candidateRevision,sourceDigest:report.sourceDigest,summary:'Both assigned viewport states were compared against the protected reference.',reviewedCaptureIds:captures.map(c=>c.structureId),unreviewed:[],findings:[]};
  const direct=new VisualReviewEvidence(report,artifacts,new Set(['baseline:responsive-layout']));for(const c of captures)await direct.capture(c.structureId);
  await assert.rejects(direct.submit({...base,referenceComparisons:comparisons(plan)}),/fidelity_context_required/);
  let referenceViews=0;
  const adapter:ProviderAdapter={name:'controlled-fidelity',run:async(task,ctx)=>{
   assert(task.tools.some(tool=>tool.name==='factory_fidelity_reference'));assert(task.prompt.includes('Protected reference comparison plan'));
   assert.equal((await ctx.onTool('factory_visual_evidence',{captureIds:captures.map(c=>c.structureId)})).success,true);
   assert.equal((await ctx.onTool('factory_visual_review',{...base,referenceComparisons:comparisons(plan)})).success,false);
   assert.equal((await ctx.onTool('factory_fidelity_reference',{stateIds:[randomUUID()]})).success,false);
   assert.equal((await ctx.onTool('factory_fidelity_reference',{stateIds:source.states.map(s=>s.stateId)})).success,true);
   assert.equal((await ctx.onTool('factory_visual_review',{...base,referenceComparisons:comparisons(plan)})).success,true);
   return{status:'completed',sessionId:null,turnId:null,text:'Compared.',usage:{inputTokens:10,cachedInputTokens:0,outputTokens:10,totalTokens:20,costMicros:null,confirmed:true}};
  }};
  const usage:ProviderUsage={inputTokens:0,cachedInputTokens:0,outputTokens:0,totalTokens:0,costMicros:null,confirmed:true};
  const result=await assessVisualCaptures(report,artifacts,adapter,{model:'fixture',instructions:'Follow the protected policy.',requirements:['baseline:responsive-layout'],maxObservedTokens:1000,fidelity:source,reference:{invoke:async args=>{assert.equal((args as any).action,'state');referenceViews++;return paired();}}},new AbortController().signal,usage,async()=>{});
  assert.equal(referenceViews,2);assert.equal(result.coverageComplete,true);assert.equal(result.visualReferenceComparisonComplete,true);assert.equal(result.releaseEligible,false);
  assert.equal(result.reviews[0].fidelity.comparisons.length,8);assert(result.reviews[0].fidelity.comparisons.every((c:any)=>c.reference.screenshot.id));
 }finally{await rm(root,{recursive:true,force:true});}
});
