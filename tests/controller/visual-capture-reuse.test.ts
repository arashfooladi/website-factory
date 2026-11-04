import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AgentArtifacts} from '../../src/agent-artifacts.js';
import {reuseVisualCapture} from '../../src/visual-capture-reuse.js';

test('capture reuse preserves bytes, replaces evidence links and refuses active, foreign or damaged snapshots',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'factory-reuse-'));
 try{
  const expected={candidate_run_id:randomUUID(),candidate_revision:'a'.repeat(40),source_digest:'b'.repeat(64),project_id:randomUUID()},records:any[]=[],bodies=new Map<string,Buffer<ArrayBuffer>>();
  const add=(kind:string,mediaType:string,body:any)=>{const id=randomUUID();records.push({id,kind,mediaType,candidateRevision:expected.candidate_revision});bodies.set(id,Buffer.from(typeof body==='string'?body:JSON.stringify(body)));return id;};
  const c={path:'/',viewport:{name:'desktop',width:1280,height:900},screenshotId:add('screenshot','image/png','image'),htmlId:add('html','text/html','<main>Original data</main>'),structureId:add('structure','application/json','{}')};
  const report={candidateRevision:expected.candidate_revision,sourceDigest:expected.source_digest,captures:[c],findings:[],coverage:{complete:true}};
  add('visual_capture_report','application/json',report);add('visual_stress_report','application/json',{...report,captures:[{...c,scenario:'synthetic-rtl-long-headings-v1'}]});
  add('visual_breakpoint_report','application/json',{...report,samples:[],findings:[{...c,key:'horizontal-overflow'}]});add('visual_preview_provenance','application/json',{sourceDigest:expected.source_digest});
  const row={...expected,status:'needs_review',attempt_id:randomUUID(),qa_environment_id:randomUUID(),artifacts:records,events:[] as any[]};let damaged=false;
  const jobs={inspect:async(owner:string)=>{if(owner!=='owner')throw new Error('not_found');return row;},artifact:async(_owner:string,_review:string,id:string)=>{if(damaged)throw new Error('artifact_hash_mismatch');return{metadata:records.find(a=>a.id===id),bytes:bodies.get(id)!};}};
  add('visual_review_task','application/json',{path:'/',skillVersions:{visualReview:'evidence-v4'}});
  add('visual_review','application/json',{candidateRevision:expected.candidate_revision,sourceDigest:expected.source_digest,releaseEligible:false,reviewedCaptureIds:[c.structureId],unreviewed:[],findings:[],coverageComplete:true});
  row.events.push({type:'task_finished',data:{path:'/',status:'completed',usage:{confirmed:true}}});
  const store=new AgentArtifacts(directory,1048576,expected.candidate_revision),id=randomUUID();
  const result=await reuseVisualCapture(jobs,'owner',id,expected,store);
  assert.equal(result.priorReviews.length,1);assert.equal(result.priorReviews[0].result.reviewedCaptureIds[0],result.capture.captures[0].structureId);
  row.events[0].data.usage.confirmed=false;const unknown=await reuseVisualCapture(jobs,'owner',id,expected,store);assert.equal(unknown.priorReviews.length,0);
  assert.notEqual(result.capture.captures[0].structureId,c.structureId);assert.equal(result.sweep.findings[0].structureId,result.capture.captures[0].structureId);
  assert.equal(result.stress.captures[0].structureId,result.capture.captures[0].structureId);
  const html=store.records.find(a=>a.id===result.capture.captures[0].htmlId)!;assert.equal(await readFile(html.filename,'utf8'),'<main>Original data</main>');
  assert.equal(JSON.parse(bodies.get(records.find(a=>a.kind==='visual_capture_report').id)!.toString()).captures[0].structureId,c.structureId);
  const inheritedRecord=records.find(a=>a.kind==='visual_review');inheritedRecord.kind='visual_prior_assessment';
  const inheritedResult=JSON.parse(bodies.get(inheritedRecord.id)!.toString());const originalReview=randomUUID();
  bodies.set(inheritedRecord.id,Buffer.from(JSON.stringify({sourceReviewId:originalReview,path:'/',result:inheritedResult})));
  const noProof=await reuseVisualCapture(jobs,'owner',id,expected,store);assert.equal(noProof.priorReviews.length,0);
  row.events.push({type:'assessment_reused',data:{path:'/',sourceReviewId:originalReview}});
  const inherited=await reuseVisualCapture(jobs,'owner',id,expected,store);assert.equal(inherited.priorReviews.length,1);assert.equal(inherited.priorReviews[0].sourceReviewId,id);
  assert.equal(inherited.priorReviews[0].result.reviewedCaptureIds[0],inherited.capture.captures[0].structureId);
  await assert.rejects(reuseVisualCapture(jobs,'foreign',id,expected,store),/not_found/);
  await assert.rejects(reuseVisualCapture(jobs,'owner',id,{...expected,source_digest:'c'.repeat(64)},store),/visual_reuse_candidate_mismatch/);
  row.status='running';await assert.rejects(reuseVisualCapture(jobs,'owner',id,expected,store),/terminal_review/);row.status='needs_review';
  damaged=true;await assert.rejects(reuseVisualCapture(jobs,'owner',id,expected,store),/artifact_hash_mismatch/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
