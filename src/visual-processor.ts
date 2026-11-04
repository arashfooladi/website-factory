import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Controller} from './controller.js';
import type {Environments} from './environments.js';
import type {ProviderAdapter} from './agent-contracts.js';
import {VisualReviewJobs,type VisualJobProcessor} from './visual-jobs.js';
import {VisualBaselines} from './visual-baselines.js';
import {reuseVisualCapture} from './visual-capture-reuse.js';
import {AgentWorkspace} from './agent-workspace.js';
import {AgentReference} from './agent-reference.js';
import {Agents} from './agents.js';
import {loadAgentInstructions} from './skills.js';
import {captureVisualMatrix} from './visual-capture.js';
import {assessVisualCaptures} from './visual-assessment.js';
import {DesignProfiles} from './design-profiles.js';
import {captureBreakpointSweep} from './visual-breakpoints.js';
import type {Page} from '@playwright/test';
import {VisualPreview} from './visual-preview.js';
import {captureContentStress} from './visual-stress.js';

export function visualProcessor(controller:Controller,environments:Environments,adapter:ProviderAdapter):VisualJobProcessor{
 return{provider:adapter.name,run:async(row,artifacts,signal,usage,event)=>{
  const candidate=(await controller.pool.query('SELECT * FROM factory.agent_runs WHERE id=$1',[row.candidate_run_id])).rows[0];
  if(!candidate||candidate.status!=='completed'||candidate.candidate_revision!==row.candidate_revision||candidate.source_digest!==row.source_digest)throw new Error('visual_candidate_changed');
  const reference=await new AgentReference(controller,row.project_id,candidate.intake_id,candidate.skill_versions.selection??controller.config.skillsetVersion).open();
  const spec=reference.context().specification;
  async function captureFresh(){
  const source=await environments.inspect(controller.config.ownerId,candidate.environment_id);
  if(source.status!=='running'||source.current_operation_id)throw new Error('visual_environment_not_running');
  const sourceWorkspace=new AgentWorkspace(environments,candidate.environment_id);
  if((await sourceWorkspace.export()).sha256!==row.source_digest)throw new Error('visual_candidate_changed');
  const preview=new VisualPreview(controller,environments,row,signal,event);
  try{
  const {environment,provenance}=await preview.open(source);
  const provenanceArtifact=await artifacts.save('visual_preview_provenance','application/json',JSON.stringify(provenance));
  const secret=JSON.parse(await readFile(join(controller.config.environmentRoot,'instances',environment.id,'private.json'),'utf8'));
  const workspace=new AgentWorkspace(environments,environment.id),origin=`http://127.0.0.1:${environment.preview_port}`;
  const paths=spec.brief.pages.filter((page:any)=>page.required).map((page:any)=>page.path)as string[];
  const manifestResult=await environments.runtime('exec',environment.id,['/tools/php','/tools/wp-cli.phar','--path=/site','eval','echo wp_json_encode(get_option("factory_build_manifest"));']);
  const manifest=JSON.parse(manifestResult.stdout),simple=manifest?.products?.find((product:any)=>product.type==='simple');
  const prepared=new WeakSet<object>();
  const hooks={sourceDigest:async()=>(await workspace.export()).sha256,browserStarted:async(browserId:string)=>event('browser_started',{browserId}),
   prepareRoute:async(page:Page,path:string)=>{
    if(!['/cart/','/checkout/'].includes(path)||prepared.has(page)||!simple?.path)return;
    await page.goto(origin+simple.path,{waitUntil:'networkidle'});await page.locator('.single_add_to_cart_button').click({timeout:30000});prepared.add(page);
   }};
  const criticalPaths=paths.filter(path=>path==='/'||/\/(shop|cart|checkout|product)(\/|$)/.test(path));
  const capture=await captureVisualMatrix({origin,token:secret.previewToken,candidateRevision:row.candidate_revision,sourceDigest:row.source_digest,paths,
   criticalPaths},artifacts,signal,hooks);
  const captured=await artifacts.save('visual_capture_report','application/json',JSON.stringify(capture));
  const sweep=await captureBreakpointSweep({origin,token:secret.previewToken,candidateRevision:row.candidate_revision,sourceDigest:row.source_digest,paths:criticalPaths.length?criticalPaths:paths},artifacts,signal,hooks);
  const sweepArtifact=await artifacts.save('visual_breakpoint_report','application/json',JSON.stringify(sweep));
  const stress=await captureContentStress({origin,token:secret.previewToken,candidateRevision:row.candidate_revision,sourceDigest:row.source_digest,paths:criticalPaths.length?criticalPaths:paths},artifacts,signal,hooks);
  const stressArtifact=await artifacts.save('visual_stress_report','application/json',JSON.stringify(stress));
  await preview.close();
  return{capture,sweep,stress,captured,sweepArtifact,stressArtifact,provenanceArtifact,priorReviews:[],previewEnvironmentId:environment.id};
  }finally{await preview.close();}
  }
  const material=row.input.reuseCaptureReviewId?await reuseVisualCapture(new VisualReviewJobs(controller,{provider:adapter.name,run:async()=>{throw new Error('visual_reader_only');}}),controller.config.ownerId,row.input.reuseCaptureReviewId,row,artifacts):await captureFresh();
  if(row.input.reuseCaptureReviewId)await event('capture_reused',{sourceReviewId:row.input.reuseCaptureReviewId});
  const {capture,sweep,stress,captured,sweepArtifact,stressArtifact,provenanceArtifact,previewEnvironmentId}=material;
  const regression=row.input.baselineId?await new VisualBaselines(controller,new VisualReviewJobs(controller,{provider:adapter.name,run:async()=>{throw new Error('visual_reader_only');}})).compare(controller.config.ownerId,row.input.baselineId,row.candidate_run_id,capture,artifacts):{status:'not-applicable',reason:'No accepted baseline selected for this initial assessment',requiresReview:false};
  const profile=candidate.design_profile_id?await new DesignProfiles(controller,adapter).assigned(controller.config.ownerId,candidate.design_profile_id):undefined;
  const loaded=await loadAgentInstructions('visual_reviewer',candidate.skill_versions.selection??controller.config.skillsetVersion,spec.brief.design,profile,{indexReviewPacks:true});
  for(const [key,value]of Object.entries(candidate.skill_versions))if(key.endsWith('_sha256')&&loaded.skillVersions[key]&&loaded.skillVersions[key]!==value)throw new Error('visual_instruction_content_changed');
  let design='';if(candidate.input_design_id){
   const record=(await controller.pool.query('SELECT * FROM factory.design_records WHERE id=$1 AND intake_id=$2',[candidate.input_design_id,candidate.intake_id])).rows[0];
   if(!record)throw new Error('visual_design_unavailable');
   design=(await new Agents(controller,environments).artifact(controller.config.ownerId,record.run_id,record.markdown_artifact_id)).bytes.toString();
  }
  const instructions=loaded.instructions+'\nProtected client brief:\n'+JSON.stringify(spec.brief)+'\nProtected DESIGN.md:\n'+design+
   '\nCompare visual fidelity using each page’s protected resolved axes. Match requires observed similarity; adapt permits client-specific departures consistent with the brief and DESIGN.md. Do not impose exact-copy expectations on free axes. Record missing comparisons as unverified; interactions require separate functional tests.';
  await artifacts.save('visual_review_instructions','text/plain',instructions);
  const reviewCaptures={...capture,captures:[...capture.captures,...stress.captures],coverage:{complete:capture.coverage.complete&&stress.coverage.complete}};
  const assessment=await assessVisualCaptures(reviewCaptures,artifacts,adapter,{model:row.model,instructions,priorReviews:material.priorReviews,skillVersions:loaded.skillVersions,requirements:spec.acceptance.requirements.map((item:any)=>item.id),maxObservedTokens:row.input.maxObservedTokens,reference,fidelity:{brief:spec.brief,states:spec.reference.states}},signal,usage,event);
  if(!row.input.reuseCaptureReviewId&&(await new AgentWorkspace(environments,candidate.environment_id).export()).sha256!==row.source_digest)throw new Error('visual_candidate_changed');
  return{candidateRevision:row.candidate_revision,sourceDigest:row.source_digest,captureReportId:captured.id,breakpointReportId:sweepArtifact.id,stressReportId:stressArtifact.id,assessment,regression,
   requiresRepair:regression.requiresReview||capture.findings.length>0||sweep.findings.length>0||stress.findings.length>0||assessment.requiresRepair,coverageComplete:capture.coverage.complete&&sweep.coverage.complete&&stress.coverage.complete&&assessment.coverageComplete,
   candidateDataIsolation:'isolated-logical-clone',previewEnvironmentId,freshPreviewObserved:!row.input.reuseCaptureReviewId,captureSourceReviewId:row.input.reuseCaptureReviewId??row.id,previewProvenanceId:provenanceArtifact.id,visualReferenceComparisonComplete:assessment.visualReferenceComparisonComplete,referenceFidelityVerified:false,releaseEligible:false,
   scope:row.input.reuseCaptureReviewId?'Assessment of the original captured data snapshot; no fresh preview was observed. Interactive fidelity and release certification remain separate gates.':'Visual quality and policy-bound reference comparisons from an isolated data clone with read-only child source/uploads. Interactive fidelity, functional/admin checks and release certification remain separate gates.'};
 }};
}
