import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import type {Environments} from './environments.js';
import type {AgentArtifacts} from './agent-artifacts.js';
import {functionalContext,type QaCandidate} from './functional-context.js';
import {checkFunctionalJourneys,type FunctionalCheck} from './functional-qa.js';
import {mailEvidence,matchesMail} from './mail-evidence.js';
export type MailFormPlan={id:string;requirementId:string;path:string;expectedText:string;expectedPath:string;fields:Array<{selector:string;value:string}>;submit:string;mail:{to:string;subjectIncludes?:string;messageIncludes:string}};

export async function checkMailForms(environments:Environments,owner:string,id:string,candidate:QaCandidate,forms:MailFormPlan[],artifacts:AgentArtifacts,signal:AbortSignal){
 const context=await functionalContext(environments,owner,id,candidate,signal);
 if(!forms.length||forms.length>6||forms.some(f=>!f.fields.some(field=>field.value.includes('{{qaToken}}'))||![f.mail.messageIncludes,f.mail.subjectIncludes??''].some(value=>value.includes('{{qaToken}}'))))throw new Error('functional_form_scope_required');
 const token='factory-qa-'+randomUUID(),substitute=(value:string)=>value.replaceAll('{{qaToken}}',token);
 const checks:FunctionalCheck[]=forms.map(form=>({...form,kind:'form',fields:form.fields.map(field=>({...field,value:substitute(field.value)}))}));
 const proof:any[]=[];
 const report=await checkFunctionalJourneys({origin:context.origin,token:context.secret.previewToken,candidateRevision:candidate.revision,sourceDigest:candidate.sourceDigest,checks},artifacts,signal,{
  sourceDigest:async()=>(await context.workspace.export()).sha256,allowMutation:true,verifyForm:async checkId=>{
   const form=forms.find(form=>form.id===checkId)!;
   const passed=matchesMail(await mailEvidence(join(environments.controller.config.environmentRoot,'instances',id,'logs','mail.jsonl')),{to:form.mail.to,subjectIncludes:form.mail.subjectIncludes?substitute(form.mail.subjectIncludes):undefined,messageIncludes:substitute(form.mail.messageIncludes)});
   proof.push({checkId,passed,sink:'isolated-mail',correlation:token});return passed;
  },
 });
 await context.stable();await artifacts.save('form_persistence_report','application/json',JSON.stringify({candidateRevision:candidate.revision,sourceDigest:candidate.sourceDigest,proof,releaseEligible:false}));return report;
}
