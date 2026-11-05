import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {Controller} from './controller.js';
import type {Environments} from './environments.js';
import type {FunctionalJobProcessor} from './functional-jobs.js';
import {FunctionalPlan} from './functional-plan.js';
import {AgentWorkspace} from './agent-workspace.js';
import {VisualPreview} from './visual-preview.js';
import {checkAdminDashboard} from './admin-dashboard-qa.js';
import {checkAdminProduct} from './admin-qa.js';
import {checkMailForms} from './form-qa.js';
import {checkCustomerAccount} from './customer-qa.js';
import {checkCommerce} from './commerce-qa.js';
import {checkFunctionalJourneys} from './functional-qa.js';
import {checkAccessibility} from './accessibility-qa.js';

export function functionalProcessor(controller:Controller,environments:Environments):FunctionalJobProcessor{
 return {provider:'protected-browser-v1',run:async(row,artifacts,signal,_usage,event)=>{
  const candidate=(await controller.pool.query('SELECT * FROM factory.agent_runs WHERE id=$1',[row.candidate_run_id])).rows[0];
  if(!candidate||candidate.status!=='completed'||candidate.candidate_revision!==row.candidate_revision||candidate.source_digest!==row.source_digest)throw new Error('functional_candidate_changed');
  const plan=FunctionalPlan.parse(row.input.plan);
  if(plan.integrations.length&&!plan.journeys.length&&!plan.forms.length&&!plan.accounts&&!plan.dashboard&&!plan.admin&&!plan.commerce&&!plan.accessibility.length){
   const blocked=plan.integrations.map(integration=>({id:integration.id,passed:false,state:'blocked',reason:'gateway_adapter_or_sandbox_credentials_unavailable',gatewayId:integration.gatewayId}));
   return{candidateRevision:row.candidate_revision,sourceDigest:row.source_digest,results:blocked,blockedChecks:blocked,requiredChecks:plan.requiredChecks,missingChecks:[],coverageComplete:false,requiresRepair:false,requiresReview:true,releaseEligible:false};
  }
  const source=await environments.inspect(controller.config.ownerId,candidate.environment_id),workspace=new AgentWorkspace(environments,source.id);
  const stable=async()=>{signal.throwIfAborted();if((await workspace.export()).sha256!==row.source_digest)throw new Error('functional_candidate_changed');};
  if(source.status!=='running'||source.current_operation_id)throw new Error('functional_environment_not_running');await stable();
  const preview=new VisualPreview(controller,environments,row,signal,event,'functional','functional'),results:any[]=plan.integrations.map(integration=>({id:integration.id,passed:false,state:'blocked',reason:'gateway_adapter_or_sandbox_credentials_unavailable',gatewayId:integration.gatewayId}));
  try{
   const {environment,provenance}=await preview.open(source);await artifacts.save('functional_preview_provenance','application/json',JSON.stringify(provenance));
   const secret=JSON.parse(await readFile(join(controller.config.environmentRoot,'instances',environment.id,'private.json'),'utf8'));
   const input={origin:`http://127.0.0.1:${environment.preview_port}`,token:secret.previewToken,candidateRevision:row.candidate_revision,sourceDigest:row.source_digest};
   const hooks={sourceDigest:async()=>(await new AgentWorkspace(environments,environment.id).export()).sha256};
   const assigned={revision:row.candidate_revision,sourceDigest:row.source_digest,sourceEnvironmentId:source.id};
   if(plan.journeys.length){
    const grouped=new Map<string,Array<{passed:boolean;reason:string|null}>>();
    for(const engine of plan.engines){await event('check_started',{module:'journeys',engine});const report=await checkFunctionalJourneys({...input,engine,checks:plan.journeys},artifacts,signal,hooks);for(const r of report.results)grouped.set(r.checkId,[...grouped.get(r.checkId)??[],{passed:r.passed,reason:r.reason}]);}
    for(const [id,verdicts]of grouped)results.push({id,passed:verdicts.length===plan.engines.length&&verdicts.every(r=>r.passed),engines:plan.engines,state:verdicts.some(r=>['functional_browser_engine_unavailable','functional_browser_engine_launch_failed'].includes(r.reason??''))?'blocked':'checked',hasDefects:verdicts.some(r=>!r.passed&&!['functional_browser_engine_unavailable','functional_browser_engine_launch_failed'].includes(r.reason??'')),reason:verdicts.find(r=>!r.passed)?.reason??null});
   }
   if(plan.forms.length){await event('check_started',{module:'forms'});const report=await checkMailForms(environments,controller.config.ownerId,environment.id,assigned,plan.forms,artifacts,signal);results.push(...report.results.map(r=>({id:r.checkId,passed:r.passed,reason:r.reason})));}
   if(plan.accounts){await event('check_started',{module:'accounts'});const report=await checkCustomerAccount(environments,controller.config.ownerId,environment.id,assigned,plan.accounts.path,artifacts,signal);results.push({id:report.requirementId,passed:report.passed,reason:report.reason});}
   if(plan.dashboard){await event('check_started',{module:'dashboard'});const report=await checkAdminDashboard(environments,controller.config.ownerId,environment.id,assigned,artifacts,signal);results.push({id:report.requirementId,passed:report.passed,reason:report.reason});}
   if(plan.admin){await event('check_started',{module:'admin'});const report=await checkAdminProduct(environments,controller.config.ownerId,environment.id,{...assigned,...plan.admin},artifacts,signal);results.push({id:report.requirementId,passed:report.passed,reason:report.reason});}
   if(plan.commerce){
    const verdicts=[];for(const engine of plan.engines){await event('check_started',{module:'commerce',engine});verdicts.push(await checkCommerce(environments,controller.config.ownerId,environment.id,assigned,{...plan.commerce,engine},artifacts,signal));}
    results.push({id:'commerce:checkout-orders',passed:verdicts.every(r=>r.passed),engines:plan.engines,state:verdicts.some(r=>r.blocked)?'blocked':'checked',hasDefects:verdicts.some(r=>!r.passed&&!r.blocked),reason:verdicts.find(r=>!r.passed)?.reason??null});
   }
   if(plan.accessibility.length){await event('check_started',{module:'accessibility'});const report=await checkAccessibility({...input,paths:plan.accessibility},artifacts,signal,hooks);results.push({id:report.requirementId,passed:!report.requiresReview,state:report.coverageComplete?'checked':'blocked',hasDefects:report.requiresRepair,reason:report.requiresReview?'accessibility_findings_require_review':null});}
   await stable();const missing=plan.requiredChecks.filter(id=>!results.some(r=>r.id===id)),failed=plan.requiredChecks.filter(id=>results.find(r=>r.id===id)?.passed!==true),blocked=results.filter(r=>plan.requiredChecks.includes(r.id)&&r.state==='blocked');
   return {candidateRevision:row.candidate_revision,sourceDigest:row.source_digest,results,requiredChecks:plan.requiredChecks,missingChecks:missing,blockedChecks:blocked,coverageComplete:missing.length===0&&blocked.length===0,requiresReview:blocked.length>0,requiresRepair:failed.some(id=>{const result=results.find(r=>r.id===id);return result?.hasDefects||result?.state!=='blocked';}),releaseEligible:false,scope:'Only the protected assigned plan is assessed. Missing integrations and unassigned flows do not constitute a release pass.'};
  }finally{await preview.close();}
 }};
}
