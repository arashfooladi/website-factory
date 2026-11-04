import type {AgentArtifacts} from './agent-artifacts.js';
import type {VisualReviewJobs} from './visual-jobs.js';

/** Import evidence into the new attempt; old records and files remain immutable. */
export async function reuseVisualCapture(jobs:Pick<VisualReviewJobs,'inspect'|'artifact'>,owner:string,id:string,
 expected:{candidate_run_id:string;candidate_revision:string;source_digest:string;project_id:string},artifacts:AgentArtifacts){
 const old=await jobs.inspect(owner,id);
 if(['queued','running','cancelling'].includes(old.status))throw new Error('visual_reuse_requires_terminal_review');
 if(old.candidate_run_id!==expected.candidate_run_id||old.candidate_revision!==expected.candidate_revision||old.source_digest!==expected.source_digest||old.project_id!==expected.project_id)throw new Error('visual_reuse_candidate_mismatch');
 async function body(kind:string){
  const matches=old.artifacts.filter((a:any)=>a.kind===kind);if(matches.length!==1)throw new Error('visual_reuse_capture_missing');
  return JSON.parse((await jobs.artifact(owner,id,matches[0].id)).bytes.toString());
 }
 const capture=await body('visual_capture_report'),sweep=await body('visual_breakpoint_report'),stress=await body('visual_stress_report'),provenance=await body('visual_preview_provenance');
 for(const report of [capture,sweep,stress])if(report.candidateRevision!==expected.candidate_revision||report.sourceDigest!==expected.source_digest)throw new Error('visual_reuse_candidate_mismatch');
 if(provenance.sourceDigest!==expected.source_digest||!capture.captures?.length||!stress.captures?.length||!Array.isArray(sweep.samples))throw new Error('visual_reuse_capture_invalid');
 const ids=new Set<string>();
 for(const c of [...capture.captures,...stress.captures,...capture.findings,...stress.findings,...sweep.findings]){
  for(const key of ['screenshotId','htmlId','structureId']){if(typeof c[key]!=='string')throw new Error('visual_reuse_capture_invalid');ids.add(c[key]);}
 }
 const replacements=new Map<string,string>();
 for(const artifactId of ids){
  const {metadata,bytes}=await jobs.artifact(owner,id,artifactId);
  if(metadata.candidateRevision!==expected.candidate_revision||!['image/png','text/html','application/json'].includes(metadata.mediaType))throw new Error('visual_reuse_artifact_invalid');
  replacements.set(artifactId,(await artifacts.save(metadata.kind,metadata.mediaType,bytes)).id);
 }
 const rewrite=(value:any):any=>Array.isArray(value)?value.map(rewrite):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,['screenshotId','htmlId','structureId'].includes(key)?replacements.get(item as string)??item:rewrite(item)])):value;
 const copied={capture:rewrite(capture),sweep:rewrite(sweep),stress:rewrite(stress)};
 const captured=await artifacts.save('visual_capture_report','application/json',JSON.stringify(copied.capture));
 const sweepArtifact=await artifacts.save('visual_breakpoint_report','application/json',JSON.stringify(copied.sweep));
 const stressArtifact=await artifacts.save('visual_stress_report','application/json',JSON.stringify(copied.stress));
 const provenanceArtifact=await artifacts.save('visual_preview_provenance','application/json',JSON.stringify(provenance));
 await artifacts.save('visual_capture_reuse','application/json',JSON.stringify({sourceReviewId:id,sourceAttemptId:old.attempt_id,candidateRevision:expected.candidate_revision,sourceDigest:expected.source_digest,
  notice:'Assessment of the original captured data snapshot; no fresh live preview was observed.'}));
 const priorReviews:any[]=[];
 const completed=new Set(old.events.filter((e:any)=>e.type==='task_finished'&&e.data.status==='completed'&&e.data.usage?.confirmed===true).map((e:any)=>e.data.path));
 const routeById=new Map([...capture.captures,...stress.captures].map((c:any)=>[c.structureId,c.path]));
 for(const item of old.artifacts.filter((a:any)=>['visual_review','visual_prior_assessment'].includes(a.kind))){
  const raw=JSON.parse((await jobs.artifact(owner,id,item.id)).bytes.toString()),inherited=item.kind==='visual_prior_assessment';
  const result=inherited?raw.result:raw;
  if(result.candidateRevision!==expected.candidate_revision||result.sourceDigest!==expected.source_digest||result.releaseEligible!==false)throw new Error('visual_reuse_assessment_invalid');
  const paths=new Set([...result.reviewedCaptureIds,...result.unreviewed.map((c:any)=>c.captureId)].map((captureId:string)=>routeById.get(captureId)));
  if(paths.size!==1||paths.has(undefined))throw new Error('visual_reuse_assessment_invalid');
  const path=[...paths][0];const inheritedProof=inherited&&old.events.some((e:any)=>e.type==='assessment_reused'&&e.data.path===path&&e.data.sourceReviewId===raw.sourceReviewId);if(!completed.has(path)&&!inheritedProof)continue;
  const tasks=old.artifacts.filter((a:any)=>a.kind==='visual_review_task');let compatible=inheritedProof;
  for(const taskArtifact of tasks){const task=JSON.parse((await jobs.artifact(owner,id,taskArtifact.id)).bytes.toString());if(task.path===path&&/^evidence-v[34]$/.test(task.skillVersions?.visualReview??''))compatible=true;}
  if(!compatible)continue;
  const remap=(value:any):any=>typeof value==='string'?replacements.get(value)??value:Array.isArray(value)?value.map(remap):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v)])):value;
  const imported=remap(result);priorReviews.push({path,result:imported,sourceReviewId:id});
  await artifacts.save('visual_prior_assessment','application/json',JSON.stringify({path,result:imported,sourceReviewId:id}));
 }
 return{...copied,captured,sweepArtifact,stressArtifact,provenanceArtifact,priorReviews,previewEnvironmentId:old.qa_environment_id};
}
