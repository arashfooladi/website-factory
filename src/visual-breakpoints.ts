import type {Page} from '@playwright/test';
import {AgentArtifacts} from './agent-artifacts.js';
import {AgentBrowser} from './agent-browser.js';

export const BREAKPOINT_WIDTHS=[479,480,481,767,768,769,1023,1024,1025]as const;

/** A bounded sweep supplements the full screenshot matrix; defects retain paired evidence. */
export async function captureBreakpointSweep(input:{origin:string;token:string;candidateRevision:string;sourceDigest:string;paths:string[]},
 artifacts:AgentArtifacts,signal:AbortSignal,hooks:{sourceDigest:()=>Promise<string>;browserStarted?:(id:string)=>Promise<void>;prepareRoute?:(page:Page,path:string)=>Promise<void>}){
 if(!/^[a-f0-9]{40}$/.test(input.candidateRevision)||!/^[a-f0-9]{64}$/.test(input.sourceDigest))throw new Error('visual_candidate_required');
 if(!input.paths.length||input.paths.length>12||input.paths.some(path=>!path.startsWith('/')||path.startsWith('//')||/[\\?#\s]/.test(path)))throw new Error('visual_paths_invalid');
 const stable=async()=>{signal.throwIfAborted();if(await hooks.sourceDigest()!==input.sourceDigest)throw new Error('visual_candidate_changed');};
 const browser=new AgentBrowser(input.origin,input.token,artifacts,signal),samples:any[]=[],findings:any[]=[];
 await stable();
 try{
  await hooks.browserStarted?.(browser.id);await browser.open({width:1025,height:900});
  await browser.protectedPage(async page=>{
   for(const path of [...new Set(input.paths)]){
    await stable();await hooks.prepareRoute?.(page,path);const response=await page.goto(input.origin+path,{waitUntil:'networkidle'});
    const resolvedPath=new URL(page.url()).pathname;
    for(const width of BREAKPOINT_WIDTHS){
     await stable();await page.setViewportSize({width,height:900});
     await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
     const geometry=await page.evaluate<{documentWidth:number}>('({documentWidth:document.documentElement.scrollWidth})');
     const keys=[];
     if(response?.status()!==200)keys.push('route-http-failure');
     if(resolvedPath.replace(/\/$/,'')!==path.replace(/\/$/,''))keys.push('route-state-not-observed');
     if(geometry.documentWidth>width+1)keys.push('horizontal-overflow');
     const sample={path,resolvedPath,viewport:{width,height:900},httpStatus:response?.status()??0,...geometry};samples.push(sample);
     if(keys.length){
      const observed=await browser.capture();
      for(const key of keys)findings.push({...sample,key,severity:'major',requirementId:'baseline:responsive-layout',candidateRevision:input.candidateRevision,
       detail:key==='horizontal-overflow'?`Document width ${geometry.documentWidth}px exceeds viewport ${width}px`:`Requested ${path} did not produce its required HTTP/route state`,
       screenshotId:observed.screenshot.id,htmlId:observed.html.id,structureId:observed.structure.id,reproduction:[`Open ${path}`,`Resize viewport to ${width}×900`]});
     }
    }
   }
  });await stable();
 }finally{await browser.close();}
 return{version:1,candidateRevision:input.candidateRevision,sourceDigest:input.sourceDigest,widths:BREAKPOINT_WIDTHS,samples,findings,
  coverage:{complete:!findings.some(f=>['route-http-failure','route-state-not-observed'].includes(f.key))},releaseEligible:false,
  scope:'Deterministic breakpoint sweep; only failing states have screenshots. Animation settling and content stress require separate checks.'};
}
