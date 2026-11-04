import {AgentBrowser} from './agent-browser.js';
import type {AgentArtifacts} from './agent-artifacts.js';

export type FunctionalCheck={id:string;requirementId:string;path:string;expectedText:string}&(
 {kind:'navigation';linkText:string;expectedPath:string}|{kind:'search';query:string});

/** Trusted checks only; the builder cannot change expectations through browser content. */
export async function checkFunctionalJourneys(input:{origin:string;token:string;candidateRevision:string;sourceDigest:string;checks:FunctionalCheck[]},
 artifacts:AgentArtifacts,signal:AbortSignal,hooks:{sourceDigest:()=>Promise<string>}){
 const origin=new URL(input.origin),validPath=(path:string)=>path.startsWith('/')&&!path.startsWith('//')&&!/[\\?#\s]/.test(path);
 if(origin.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(origin.hostname)||origin.origin!==input.origin)throw new Error('functional_isolated_origin_required');
 if(!/^[a-f0-9]{40}$/.test(input.candidateRevision)||!/^[a-f0-9]{64}$/.test(input.sourceDigest))throw new Error('functional_candidate_required');
 if(!input.checks.length||input.checks.length>24||new Set(input.checks.map(c=>c.id)).size!==input.checks.length||input.checks.some(c=>!validPath(c.path)||!c.expectedText||!c.requirementId||c.kind==='navigation'&&!validPath(c.expectedPath)||c.kind==='search'&&!c.query))throw new Error('functional_checks_invalid');
 const stable=async()=>{signal.throwIfAborted();if(await hooks.sourceDigest()!==input.sourceDigest)throw new Error('functional_candidate_changed');};
 const results=[];
 for(const check of input.checks){
  await stable();const browser=new AgentBrowser(input.origin,input.token,artifacts,signal);let before:Awaited<ReturnType<AgentBrowser['capture']>>|null=null,after:Awaited<ReturnType<AgentBrowser['capture']>>|null=null;
  let passed=false,reason:string|null=null;
  try{
   await browser.open({width:1280,height:900});
   await browser.protectedPage(async page=>{
    let status=0;page.on('response',response=>{if(response.request().isNavigationRequest()&&response.frame()===page.mainFrame())status=response.status();});
    await page.goto(input.origin+check.path,{waitUntil:'networkidle'});before=await browser.capture();
    if(status!==200)throw new Error('functional_initial_http_failure');
    if(check.kind==='navigation'){
     const link=page.getByRole('link',{name:check.linkText,exact:true}).first(),href=await link.getAttribute('href');
     const target=href?new URL(href,input.origin):null,expectedPath=new URL(check.expectedPath,input.origin).pathname;
     if(!target||target.origin!==input.origin||target.pathname!==expectedPath||target.search!=='')throw new Error('functional_link_target_wrong');
     await link.click();await page.waitForURL(url=>url.origin===input.origin&&url.pathname===expectedPath);
    }else{
     const search=page.locator('input[name="s"]').first(),form=search.locator('xpath=ancestor::form').first();
     const action=new URL(await form.getAttribute('action')||page.url(),input.origin);
     if((await form.getAttribute('method')||'get').toLowerCase()!=='get'||action.origin!==input.origin||action.search)throw new Error('functional_search_form_contract_wrong');
     await search.fill(check.query);await search.press('Enter');
     await page.waitForURL(url=>url.origin===input.origin&&url.searchParams.get('s')===check.query);
    }
    await page.waitForLoadState('networkidle');after=await browser.capture();
    if(status!==200)throw new Error('functional_destination_http_failure');
    if(!(await page.locator('main').innerText()).includes(check.expectedText))throw new Error('functional_expected_content_missing');
    passed=true;
   });
  }catch(error){
   reason=error instanceof Error&&/^functional_[a-z_]+$/.test(error.message)?error.message:'functional_interaction_failed';
   if(!after)after=await browser.capture().catch(()=>null);
  }finally{await browser.close();}
  await stable();results.push({checkId:check.id,requirementId:check.requirementId,kind:check.kind,path:check.path,passed,reason,before,after,
   reproduction:check.kind==='search'?[`Open ${check.path}`,`Search for ${check.query}`,`Expect ${check.expectedText} in main content`]:[`Open ${check.path}`,`Click link ${check.linkText}`,`Expect ${check.expectedPath} containing ${check.expectedText}`]});
 }
 await stable();
 const report={candidateRevision:input.candidateRevision,sourceDigest:input.sourceDigest,results,requiresRepair:results.some(r=>!r.passed),releaseEligible:false,
  scope:'Navigation and GET search only. WordPress admin, forms, cart, checkout and accessibility remain separate checks.'};
 await artifacts.save('functional_journey_report','application/json',JSON.stringify(report));return report;
}
