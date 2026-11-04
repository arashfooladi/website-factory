import type {Page} from '@playwright/test';
import {AgentArtifacts} from './agent-artifacts.js';
import {AgentBrowser} from './agent-browser.js';

export async function captureContentStress(input:{origin:string;token:string;candidateRevision:string;sourceDigest:string;paths:string[]},
 artifacts:AgentArtifacts,signal:AbortSignal,hooks:{sourceDigest:()=>Promise<string>;browserStarted?:(id:string)=>Promise<void>;prepareRoute?:(page:Page,path:string)=>Promise<void>}){
 if(!/^[a-f0-9]{40}$/.test(input.candidateRevision)||!/^[a-f0-9]{64}$/.test(input.sourceDigest))throw new Error('visual_candidate_required');
 if(!input.paths.length||input.paths.length>12||input.paths.some(path=>!path.startsWith('/')||path.startsWith('//')||/[\\?#\s]/.test(path)))throw new Error('visual_paths_invalid');
 const captures:any[]=[],findings:any[]=[];
 const stable=async()=>{signal.throwIfAborted();if(await hooks.sourceDigest()!==input.sourceDigest)throw new Error('visual_candidate_changed');};
 for(const viewport of [{name:'rtl-long-content-mobile',width:390,height:844},{name:'rtl-long-content-landscape',width:844,height:390}]){
  await stable();const browser=new AgentBrowser(input.origin,input.token,artifacts,signal);
  try{
   await hooks.browserStarted?.(browser.id);await browser.open(viewport);
   await browser.protectedPage(async page=>{
    for(const path of [...new Set(input.paths)]){
     await stable();await hooks.prepareRoute?.(page,path);const response=await page.goto(input.origin+path,{waitUntil:'networkidle'});
     // DOM-only synthetic content: never save these substitutions into WordPress.
     const changed=await page.evaluate<number>(`(()=>{document.documentElement.dir='rtl';document.documentElement.lang='fa';let changed=0;for(const node of document.querySelectorAll('main h1,main h2,main h3,main .woocommerce-loop-product__title')){if(node.children.length)continue;node.textContent='مجموعه یادداشت‌ها و محصولات ویژه برای یک روز روشن و آرام در کنار شما — نسخهٔ سفارشی شماره ۱۲۳۴۵۶۷۸۹۰';changed++;if(changed===12)break;}return changed;})()`);
     await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
     const geometry=await page.evaluate<{documentWidth:number}>('({documentWidth:document.documentElement.scrollWidth})');
     const observed=await browser.capture(),shared={path,resolvedPath:new URL(page.url()).pathname,viewport,scenario:'synthetic-rtl-long-headings-v1',
      candidateRevision:input.candidateRevision,screenshotId:observed.screenshot.id,htmlId:observed.html.id,structureId:observed.structure.id};
     captures.push({...shared,changedHeadings:changed,httpStatus:response?.status()??0,geometry});
     const add=(key:string,detail:string)=>findings.push({...shared,key,detail,severity:'major',requirementId:'baseline:responsive-layout',reproduction:[`Open ${path}`,`Set viewport to ${viewport.width}×${viewport.height}`,'Apply synthetic-rtl-long-headings-v1 DOM stress fixture; original WordPress data stays unchanged']});
     if(response?.status()!==200)add('route-http-failure',`Received HTTP ${response?.status()??0}`);
     if(shared.resolvedPath.replace(/\/$/,'')!==path.replace(/\/$/,''))add('route-state-not-observed',`Requested ${path} resolved to ${shared.resolvedPath}`);
     if(geometry.documentWidth>viewport.width+1)add('horizontal-overflow',`Synthetic RTL content widened the document to ${geometry.documentWidth}px`);
     if(!changed)add('stress-state-not-observed','No eligible main heading accepted the long-content substitution; only forced RTL was observed');
    }
   });await stable();
  }finally{await browser.close();}
 }
 return{version:1,candidateRevision:input.candidateRevision,sourceDigest:input.sourceDigest,captures,findings,
  coverage:{complete:!findings.some(f=>['route-http-failure','route-state-not-observed','stress-state-not-observed'].includes(f.key))},
  releaseEligible:false,scope:'Synthetic DOM-only RTL/long-heading stress. These substitutions are not actual client content or a functional test.'};
}
