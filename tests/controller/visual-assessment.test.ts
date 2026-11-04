import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AgentArtifacts} from '../../src/agent-artifacts.js';
import {assessVisualCaptures} from '../../src/visual-assessment.js';
import type {ProviderAdapter,ProviderUsage} from '../../src/agent-contracts.js';

test('independent assessment uses bounded evidence-only tools and rejects incomplete or unaccounted provider outcomes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'factory-assessment-'));
 try{
  const artifacts=new AgentArtifacts(root,1048576),image=await artifacts.save('screenshot','image/png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNkoAAAAASUVORK5CYII=','base64'));
  const html=await artifacts.save('rendered_html','text/html','<main>Fixture content</main>'),structure=await artifacts.save('page_structure','application/json','{"width":320}');
  const capture={path:'/',viewport:{width:320,height:568},screenshotId:image.id,htmlId:html.id,structureId:structure.id,geometry:{secretDetectorVerdict:'bad'}};
  const report={candidateRevision:'a'.repeat(40),sourceDigest:'b'.repeat(64),coverage:{complete:true},captures:[capture]};let mode='valid';
  const adapter:ProviderAdapter={name:'controlled-review',run:async(task,ctx)=>{
   assert.equal(task.role,'visual_reviewer');assert.deepEqual(task.tools.map(t=>t.name),['factory_visual_evidence','factory_visual_read','factory_visual_review']);assert(!task.prompt.includes('secretDetectorVerdict'));
   for(const tool of task.tools.filter(t=>t.name!=='factory_visual_read')){const schema=JSON.stringify(tool.inputSchema);assert(schema.includes(structure.id));assert(!schema.includes(image.id));}
   assert.equal((await ctx.onTool('host_shell',{})).success,false);
   const paired=await ctx.onTool('factory_visual_evidence',{captureIds:[structure.id]});assert.equal(paired.success,true);assert(paired.contentItems.some(item=>item.type==='inputImage'));
   assert(JSON.stringify(paired.contentItems).includes('captureId'));
   assert.equal((await ctx.onTool('factory_visual_read',{artifactId:html.id,offset:6,length:7})).success,true);
   if(mode!=='missing')assert.equal((await ctx.onTool('factory_visual_review',{candidateRevision:report.candidateRevision,sourceDigest:report.sourceDigest,summary:'This controlled fixture has been inspected using its paired evidence.',reviewedCaptureIds:[structure.id],unreviewed:[],findings:[]})).success,true);
   return{status:'completed',sessionId:null,turnId:null,text:'Submitted.',usage:{inputTokens:20,cachedInputTokens:0,outputTokens:5,totalTokens:mode==='overrun'?1500:25,costMicros:null,confirmed:mode!=='unknown'}};
  }};
  const run=(inventory=report)=>{const usage:ProviderUsage={inputTokens:0,cachedInputTokens:0,outputTokens:0,totalTokens:0,costMicros:null,confirmed:true};return assessVisualCaptures(inventory,artifacts,adapter,{model:'fixture',instructions:'Inspect the fixture without changing it.',requirements:['baseline:responsive-layout'],maxObservedTokens:1000},new AbortController().signal,usage,async()=>{});};
  assert.equal((await run()).coverageComplete,true);
  assert(artifacts.records.some(item=>item.kind==='visual_review_task'));
  await assert.rejects(run({...report,captures:[]}),/visual_capture_inventory_invalid/);
  await assert.rejects(run({...report,captures:[capture,capture]}),/visual_capture_inventory_invalid/);
  mode='missing';await assert.rejects(run(),/visual_review_incomplete/);
  mode='unknown';await assert.rejects(run(),/visual_review_usage_unconfirmed/);
  mode='overrun';await assert.rejects(run(),/visual_review_budget_exceeded/);
 }finally{await rm(root,{recursive:true,force:true});}
});
