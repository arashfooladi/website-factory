import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {Controller,ControllerError} from './controller.js';
import {AgentArtifacts} from './agent-artifacts.js';
import type {VisualReviewJobs} from './visual-jobs.js';
import {reuseVisualCapture} from './visual-capture-reuse.js';
import {sha256} from './immutable.js';

export function comparePng(before:Buffer,after:Buffer){
 for(const bytes of [before,after])if(bytes.length<24||bytes.length>16777216||bytes.readUInt32BE(16)*bytes.readUInt32BE(20)>10000000)throw new Error('regression_image_limit');
 const a=PNG.sync.read(before),b=PNG.sync.read(after);
 if(a.width!==b.width||a.height!==b.height)return{changed:true,dimensionMismatch:true,changedRatio:1};
 let changed=0;for(let i=0;i<a.data.length;i+=4)if([0,1,2,3].some(channel=>Math.abs(a.data[i+channel]!-b.data[i+channel]!)>12))changed++;
 const changedRatio=changed/(a.width*a.height);return{changed:changedRatio>0.005,dimensionMismatch:false,changedRatio};
}
const key=(c:any)=>JSON.stringify([c.path,c.viewport.width,c.viewport.height,c.scenario??'actual-candidate']);
export class VisualBaselines{
 constructor(readonly controller:Controller,readonly jobs:Pick<VisualReviewJobs,'inspect'|'artifact'>){}
 private directory(id:string){return join(this.controller.config.visualRoot,'baselines',id);}
 async accept(owner:string,reviewId:string){
  const review=await this.jobs.inspect(owner,reviewId);
  if(review.status!=='reviewed'||review.report?.coverageComplete!==true||review.report?.requiresRepair!==false)throw new ControllerError('visual_baseline_passing_review_required');
  const candidate=(await this.controller.pool.query('SELECT i.acceptance_sha256 FROM factory.agent_runs r JOIN factory.intakes i ON i.id=r.intake_id WHERE r.id=$1',[review.candidate_run_id])).rows[0];
  if(!/^[a-f0-9]{64}$/.test(candidate?.acceptance_sha256))throw new ControllerError('visual_baseline_acceptance_missing');
  const id=randomUUID(),artifacts=new AgentArtifacts(this.directory(id),268435456,review.candidate_revision);
  const copied=await reuseVisualCapture(this.jobs,owner,reviewId,review,artifacts);
  const manifest={captures:copied.capture.captures,threshold:{channelDelta:12,maxChangedRatio:0.005}};
  await this.controller.pool.query(`INSERT INTO factory.visual_baselines(id,project_id,review_id,candidate_revision,source_digest,acceptance_sha256,manifest,artifacts,approved_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
   [id,review.project_id,reviewId,review.candidate_revision,review.source_digest,candidate.acceptance_sha256,manifest,JSON.stringify(artifacts.records.map(({filename,...a})=>a)),owner]);
  return{id,reviewId,releaseEligible:false};
 }
 async owned(owner:string,id:string){const row=(await this.controller.pool.query('SELECT b.* FROM factory.visual_baselines b JOIN factory.projects p ON p.id=b.project_id WHERE b.id=$1 AND p.owner_id=$2',[id,owner])).rows[0];if(!row)throw new ControllerError('not_found',404);return row;}
 async compare(owner:string,id:string,candidateRunId:string,report:any,artifacts:AgentArtifacts){
  const baseline=await this.owned(owner,id),candidate=(await this.controller.pool.query('SELECT r.*,i.acceptance_sha256 FROM factory.agent_runs r JOIN factory.intakes i ON i.id=r.intake_id WHERE r.id=$1',[candidateRunId])).rows[0];
  if(!candidate||candidate.project_id!==baseline.project_id||candidate.acceptance_sha256!==baseline.acceptance_sha256||candidate.candidate_revision!==report.candidateRevision||candidate.source_digest!==report.sourceDigest)throw new Error('visual_regression_candidate_mismatch');
  const current=new Map<string,any>();for(const c of report.captures){if(current.has(key(c)))throw new Error('visual_regression_duplicate_capture');current.set(key(c),c);}
  const results:any[]=[];
  for(const old of baseline.manifest.captures){
   const fresh=current.get(key(old));if(!fresh){results.push({path:old.path,viewport:old.viewport,status:'unverified',reason:'current_capture_missing'});continue;}
   current.delete(key(old));
   const original=baseline.artifacts.find((a:any)=>a.id===old.screenshotId),next=artifacts.records.find(a=>a.id===fresh.screenshotId);
   if(!original||!next)throw new Error('visual_regression_artifact_missing');
   const [a,b]=await Promise.all([readFile(join(this.directory(id),original.id)),readFile(next.filename)]);
   if(sha256(a)!==original.sha256||sha256(b)!==next.sha256)throw new Error('visual_regression_artifact_changed');
   results.push({path:old.path,viewport:old.viewport,baselineCaptureId:old.structureId,captureId:fresh.structureId,...comparePng(a,b),status:'compared'});
  }
  for(const fresh of current.values())results.push({path:fresh.path,viewport:fresh.viewport,status:'unverified',reason:'baseline_capture_missing'});
  const result={baselineId:id,baselineRevision:baseline.candidate_revision,candidateRevision:report.candidateRevision,sourceDigest:report.sourceDigest,results,
   coverageComplete:results.length>0&&results.every(r=>r.status==='compared'),requiresReview:results.some(r=>r.changed||r.status!=='compared'),releaseEligible:false};
  await artifacts.save('visual_regression_report','application/json',JSON.stringify(result));return result;
 }
}
