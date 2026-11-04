import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {AgentArtifacts} from '../../src/agent-artifacts.js';
import {VisualReviewEvidence} from '../../src/visual-review.js';

test('visual review binds findings to viewed evidence and accounts honestly for unreviewed captures',async()=>{
 const root=await mkdtemp(join(tmpdir(),'factory-review-'));
 try{
  const artifacts=new AgentArtifacts(root,1048576),image=await artifacts.save('screenshot','image/png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNkoAAAAASUVORK5CYII=','base64'));
  const html=await artifacts.save('rendered_html','text/html','<main>Actual fixture content</main>'),layout=await artifacts.save('page_structure','application/json','{"width":320}'),other=await artifacts.save('page_structure','application/json','{"width":390}');
  const a={path:'/',viewport:{width:320,height:568},screenshotId:image.id,htmlId:html.id,structureId:layout.id},b={...a,path:'/shop/',structureId:other.id};
  const report={candidateRevision:'a'.repeat(40),sourceDigest:'b'.repeat(64),captures:[a,b]};
  const evidence=new VisualReviewEvidence(report,artifacts,new Set(['baseline:responsive-layout']));
  const raw={candidateRevision:report.candidateRevision,sourceDigest:report.sourceDigest,summary:'The first captured route shows a reproducible layout defect.',reviewedCaptureIds:[a.structureId],unreviewed:[{captureId:b.structureId,reason:'The second capture has not been inspected yet.'}],findings:[{captureId:a.structureId,requirementId:'baseline:responsive-layout',category:'responsive',severity:'major',detail:'The main content extends beyond the narrow viewport boundary.',recommendation:'Allow the main content to wrap within the viewport.',reproduction:['Open the home page at 320 by 568 pixels.']}]};
  await assert.rejects(evidence.submit(raw),/visual_review_coverage_invalid/);
  await assert.rejects(evidence.capture(randomUUID()),/visual_capture_not_found/);
  await assert.rejects(evidence.captureMany([a.structureId,randomUUID()]),/visual_capture_not_found/);
  await assert.rejects(evidence.submit(raw),/visual_review_coverage_invalid/);
  const paired=await evidence.capture(a.structureId);assert(paired.html.content.includes('Actual fixture content'));
  await assert.rejects(evidence.read(randomUUID()),/visual_evidence_denied/);
  await assert.rejects(evidence.read(a.htmlId,0,16001),/visual_evidence_range_invalid/);
  await assert.rejects(evidence.submit({...raw,sourceDigest:'c'.repeat(64)}),/visual_review_candidate_mismatch/);
  await assert.rejects(evidence.submit({...raw,unreviewed:[]}),/visual_review_coverage_invalid/);
  await assert.rejects(evidence.submit({...raw,findings:[{...raw.findings[0],captureId:b.structureId}]}),/visual_finding_evidence_invalid/);
  const saved=await evidence.submit(raw);
  assert.equal(saved.result.coverageComplete,false);assert.equal(saved.result.requiresRepair,true);assert.equal(saved.result.releaseEligible,false);
  assert.equal(saved.result.findings[0]!.capture.path,'/');
  await assert.rejects(evidence.submit(raw),/visual_review_already_submitted/);
 }finally{await rm(root,{recursive:true,force:true});}
});
