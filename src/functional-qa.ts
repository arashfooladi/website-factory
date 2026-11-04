import {AgentBrowser} from './agent-browser.js';
import type {AgentArtifacts} from './agent-artifacts.js';

export type FunctionalCheck={id:string;requirementId:string;path:string;expectedText:string}&(
 {kind:'navigation';linkText:string;expectedPath:string}|{kind:'search';query:string}|{kind:'filter';selector:string;value:string;excludedText:string}|{kind:'form';fields:Array<{selector:string;value:string}>;submit:string;expectedPath:string}|{kind:'keyboard';target:string;expectedPath:string;maxTabs?:number});

/** Trusted checks only; the builder cannot change expectations through browser content. */
export async function checkFunctionalJourneys(input:{origin:string;token:string;candidateRevision:string;sourceDigest:string;checks:FunctionalCheck[];engine?:'chromium'|'firefox'|'webkit'},
 artifacts:AgentArtifacts,signal:AbortSignal,hooks:{sourceDigest:()=>Promise<string>;allowMutation?:boolean;verifyForm?:(id:string)=>Promise<boolean>}){
 const origin=new URL(input.origin),validPath=(path:string)=>path.startsWith('/')&&!path.startsWith('//')&&!/[\\?#\s]/.test(path);
 if(origin.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(origin.hostname)||origin.origin!==input.origin)throw new Error('functional_isolated_origin_required');
 if(!/^[a-f0-9]{40}$/.test(input.candidateRevision)||!/^[a-f0-9]{64}$/.test(input.sourceDigest))throw new Error('functional_candidate_required');
 if(!input.checks.length||input.checks.length>24||new Set(input.checks.map(c=>c.id)).size!==input.checks.length||input.checks.some(c=>!validPath(c.path)||!c.expectedText||!c.requirementId||['navigation','form','keyboard'].includes(c.kind)&&!validPath((c as {expectedPath:string}).expectedPath)||c.kind==='search'&&!c.query))throw new Error('functional_checks_invalid');
 const stable=async()=>{signal.throwIfAborted();if(await hooks.sourceDigest()!==input.sourceDigest)throw new Error('functional_candidate_changed');};
 const results=[];
 for(const check of input.checks){
  await stable();const browser=new AgentBrowser(input.origin,input.token,artifacts,signal,undefined,input.engine);let before:Awaited<ReturnType<AgentBrowser['capture']>>|null=null,after:Awaited<ReturnType<AgentBrowser['capture']>>|null=null;
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
    }else if(check.kind==='search'){
     const search=page.locator('input[name="s"]').first(),form=search.locator('xpath=ancestor::form').first();
     const action=new URL(await form.getAttribute('action')||page.url(),input.origin);
     if((await form.getAttribute('method')||'get').toLowerCase()!=='get'||action.origin!==input.origin||action.search)throw new Error('functional_search_form_contract_wrong');
     await search.fill(check.query);await search.press('Enter');
     await page.waitForURL(url=>url.origin===input.origin&&url.searchParams.get('s')===check.query);
    }
    if(check.kind==='filter'){
     const filter=page.locator(check.selector);if(await filter.count()!==1)throw new Error('functional_filter_ambiguous');
     await filter.selectOption(check.value);await page.waitForLoadState('load');
     await page.waitForFunction(({expected,excluded})=>{const text=document.querySelector('main')?.textContent||'';return text.includes(expected)&&!text.includes(excluded);},{expected:check.expectedText,excluded:check.excludedText});
    }
    if(check.kind==='form'){
     if(!hooks.allowMutation||!hooks.verifyForm)throw new Error('functional_form_oracle_required');
     const submit=page.locator(check.submit),form=submit.locator('xpath=ancestor::form').first(),action=new URL(await form.getAttribute('action')||page.url(),input.origin);
     if(action.origin!==input.origin)throw new Error('functional_form_origin_wrong');
     for(const field of check.fields)await page.locator(field.selector).fill(field.value);
     await submit.click();await page.waitForURL(url=>url.origin===input.origin&&url.pathname===check.expectedPath);
     if(!await hooks.verifyForm(check.id))throw new Error('functional_form_persistence_missing');
    }
    if(check.kind==='keyboard'){
     const target=page.locator(check.target);if(await target.count()!==1)throw new Error('functional_keyboard_target_ambiguous');
     let reached=false;
     for(let index=0;index<(check.maxTabs??40);index++){
      await page.keyboard.press('Tab');if(await target.evaluate(element=>element===document.activeElement)){reached=true;break;}
     }
     if(!reached)throw new Error('functional_keyboard_target_unreachable');
     if(!await target.evaluate(element=>{const style=getComputedStyle(element);return style.visibility!=='hidden'&&style.display!=='none'&&element.getBoundingClientRect().width>0;}))throw new Error('functional_keyboard_target_hidden');
     before=await browser.capture();await page.keyboard.press('Enter');await page.waitForURL(url=>url.origin===input.origin&&url.pathname===check.expectedPath);
    }
    await page.waitForLoadState('networkidle');after=await browser.capture();
    if(status!==200)throw new Error('functional_destination_http_failure');
    if(!(await page.locator('main').innerText()).includes(check.expectedText))throw new Error('functional_expected_content_missing');
    if(check.kind==='filter'&&(await page.locator('main').innerText()).includes(check.excludedText))throw new Error('functional_filter_exclusion_failed');
    passed=true;
   });
  }catch(error){
   reason=error instanceof Error&&/^functional_[a-z_]+$/.test(error.message)?error.message:'functional_interaction_failed';
   if(!after)after=await browser.capture().catch(()=>null);
  }finally{await browser.close();}
  await stable();results.push({checkId:check.id,requirementId:check.requirementId,kind:check.kind,path:check.path,passed,reason,before,after,
   reproduction:check.kind==='form'?['Open '+check.path,'Fill the protected form fields','Submit and verify persisted outcome']:check.kind==='filter'?['Open '+check.path,'Select '+check.value+' using '+check.selector,'Verify included/excluded results']:check.kind==='keyboard'?['Open '+check.path,'Tab to '+check.target,'Press Enter and verify '+check.expectedPath]:check.kind==='search'?[`Open ${check.path}`,`Search for ${check.query}`,`Expect ${check.expectedText} in main content`]:[`Open ${check.path}`,`Click link ${check.linkText}`,`Expect ${check.expectedPath} containing ${check.expectedText}`]});
 }
 await stable();
 const report={candidateRevision:input.candidateRevision,sourceDigest:input.sourceDigest,results,requiresRepair:results.some(r=>!r.passed),releaseEligible:false,
  scope:'Protected navigation, search, filtering, form persistence and keyboard journeys. Only explicitly assigned checks are covered; WordPress admin, commerce and automated accessibility have separate reports.'};
 await artifacts.save('functional_journey_report','application/json',JSON.stringify(report));return report;
}
