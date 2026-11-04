import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Controller} from './controller.js';
import type {Environments} from './environments.js';
import type {FunctionalJobProcessor} from './functional-jobs.js';
import {FunctionalPlan} from './functional-plan.js';
import {AgentWorkspace} from './agent-workspace.js';
import {VisualPreview} from './visual-preview.js';
import {checkAdminProduct} from './admin-qa.js';
import {checkCommerce} from './commerce-qa.js';
import {checkFunctionalJourneys} from './functional-qa.js';
import {checkAccessibility} from './accessibility-qa.js';

export function functionalProcessor(controller:Controller,environments:Environments):FunctionalJobProcessor{
 return {provider:'protected-browser-v1',run:async(row,artifacts,signal,_usage,event)=>{
  const candidate=(await controller.pool.query('SELECT * FROM factory.agent_runs WHERE id=$1',[row.candidate_run_id])).rows[0];
  if(!candidate||candidate.status!=='completed'||candidate.candidate_revision!==row.candidate_revision||candidate.source_digest!==row.source_digest)throw new Error('functional_candidate_changed');
  const plan=FunctionalPlan.parse(row.input.plan),source=await environments.inspect(controller.config.ownerId,candidate.environment_id),workspace=new AgentWorkspace(environments,source.id);
  const stable=async()=>{signal.throwIfAborted();if((await workspace.export()).sha256!==row.source_digest)throw new Error('functional_candidate_changed');};
  if(source.status!=='running'||source.current_operation_id)throw new Error('functional_environment_not_running');await stable();
  const preview=new VisualPreview(controller,environments,row,signal,event,'functional','functional'),results:any[]=[];
  try{
   const {environment,provenance}=await preview.open(source);await artifacts.save('functional_preview_provenance','application/json',JSON.stringify(provenance));
   const secret=JSON.parse(await readFile(join(controller.config.environmentRoot,'instances',environment.id,'private.json'),'utf8'));
   const input={origin:`http://127.0.0.1:${environment.preview_port}`,token:secret.previewToken,candidateRevision:row.candidate_revision,sourceDigest:row.source_digest};
   const hooks={sourceDigest:async()=>(await new AgentWorkspace(environments,environment.id).export()).sha256};
   const assigned={revision:row.candidate_revision,sourceDigest:row.source_digest,sourceEnvironmentId:source.id};
   if(plan.journeys.length){await event('check_started',{module:'journeys'});const report=await checkFunctionalJourneys({...input,checks:plan.journeys},artifacts,signal,hooks);results.push(...report.results.map(r=>({id:r.checkId,passed:r.passed,reason:r.reason})));}
   if(plan.admin){await event('check_started',{module:'admin'});const report=await checkAdminProduct(environments,controller.config.ownerId,environment.id,{...assigned,...plan.admin},artifacts,signal);results.push({id:report.requirementId,passed:report.passed,reason:report.reason});}
   if(plan.commerce){await event('check_started',{module:'commerce'});const report=await checkCommerce(environments,controller.config.ownerId,environment.id,assigned,plan.commerce,artifacts,signal);results.push({id:report.requirementId,passed:report.passed,reason:report.reason});}
   if(plan.accessibility.length){await event('check_started',{module:'accessibility'});const report=await checkAccessibility({...input,paths:plan.accessibility},artifacts,signal,hooks);results.push({id:report.requirementId,passed:!report.requiresReview,reason:report.requiresReview?'accessibility_findings_require_review':null});}
   await stable();const missing=plan.requiredChecks.filter(id=>!results.some(r=>r.id===id)),failed=plan.requiredChecks.filter(id=>results.find(r=>r.id===id)?.passed!==true);
   return {candidateRevision:row.candidate_revision,sourceDigest:row.source_digest,results,requiredChecks:plan.requiredChecks,missingChecks:missing,coverageComplete:missing.length===0,requiresRepair:failed.length>0,releaseEligible:false,scope:'Only the protected assigned plan is assessed. Missing integrations and unassigned flows do not constitute a release pass.'};
  }finally{await preview.close();}
 }};
}
