import AxeBuilder from '@axe-core/playwright';
import {AgentBrowser} from './agent-browser.js';
import type {AgentArtifacts} from './agent-artifacts.js';

/** Automated WCAG checks supplement the independently assigned keyboard journeys. */
export async function checkAccessibility(input:{origin:string;token:string;candidateRevision:string;sourceDigest:string;paths:string[]},artifacts:AgentArtifacts,signal:AbortSignal,hooks:{sourceDigest:()=>Promise<string>}){
 if(!/^[a-f0-9]{40}$/.test(input.candidateRevision)||!/^[a-f0-9]{64}$/.test(input.sourceDigest)||!input.paths.length||input.paths.length>24||input.paths.some(path=>!path.startsWith('/')||path.startsWith('//')||/[\\?#\s]/.test(path)))throw new Error('accessibility_qa_input_invalid');
 const stable=async()=>{signal.throwIfAborted();if(await hooks.sourceDigest()!==input.sourceDigest)throw new Error('accessibility_qa_candidate_changed');};
 const results:Array<{path:string;viewport:{width:number;height:number};passed:boolean;violations:Awaited<ReturnType<AxeBuilder['analyze']>>['violations'];incomplete:Awaited<ReturnType<AxeBuilder['analyze']>>['incomplete'];evidence:Awaited<ReturnType<AgentBrowser['capture']>>|null;reason:string|null}>=[];
 for(const path of input.paths){for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  await stable();const browser=new AgentBrowser(input.origin,input.token,artifacts,signal);let evidence:Awaited<ReturnType<AgentBrowser['capture']>>|null=null;
  try{
   await browser.open(viewport);const analysis=await browser.protectedPage(async page=>{
    await page.goto(input.origin+path,{waitUntil:'load'});evidence=await browser.capture();if(browser.httpStatus!==200)throw new Error('accessibility_qa_http_failure');
    return new AxeBuilder({page}).setLegacyMode().withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
   });
   results.push({path,viewport,passed:analysis.violations.length===0&&analysis.incomplete.length===0,violations:analysis.violations,incomplete:analysis.incomplete,evidence,reason:null});
  }catch(error){evidence??=await browser.capture().catch(()=>null);results.push({path,viewport,passed:false,violations:[],incomplete:[],evidence,reason:error instanceof Error&&/^accessibility_qa_[a-z_]+$/.test(error.message)?error.message:'accessibility_qa_execution_failed'});}
  finally{await browser.close();}await stable();
 }}
 const report={candidateRevision:input.candidateRevision,sourceDigest:input.sourceDigest,requirementId:'accessibility:automated',results,requiresReview:results.some(r=>!r.passed),releaseEligible:false,scope:'Automated WCAG A/AA checks at desktop/mobile sizes. Incomplete rules require review; keyboard and human assistive-technology assessment are separate.'};
 await artifacts.save('accessibility_report','application/json',JSON.stringify(report));return report;
}
