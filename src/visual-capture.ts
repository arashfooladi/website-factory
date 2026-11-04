import {AgentBrowser} from './agent-browser.js';
import {AgentArtifacts} from './agent-artifacts.js';
import type {Page} from '@playwright/test';

export const VISUAL_VIEWPORTS=[
  {name:'desktop',width:1280,height:900,allRoutes:true},
  {name:'mobile',width:390,height:844,allRoutes:true},
  {name:'narrow',width:320,height:568,allRoutes:false},
  {name:'landscape',width:844,height:390,allRoutes:false},
  {name:'short',width:1440,height:320,allRoutes:false},
  {name:'ultrawide',width:3440,height:1440,allRoutes:false},
]as const;

export async function captureVisualMatrix(input:{origin:string;token:string;candidateRevision:string;sourceDigest:string;paths:string[];criticalPaths:string[]},
  artifacts:AgentArtifacts,signal:AbortSignal,hooks:{sourceDigest:()=>Promise<string>;browserStarted?:(id:string)=>Promise<void>;prepareRoute?:(page:Page,path:string)=>Promise<void>}){
  if(!/^[a-f0-9]{40}$/.test(input.candidateRevision)||!/^[a-f0-9]{64}$/.test(input.sourceDigest))throw new Error('visual_candidate_required');
  const paths=[...new Set(input.paths)],critical=[...new Set(input.criticalPaths)];
  if(!paths.length||paths.length>24||critical.some(path=>!paths.includes(path))||paths.some(path=>!path.startsWith('/')||path.startsWith('//')||/[\\?#\s]/.test(path)))throw new Error('visual_paths_invalid');
  const stable=async()=>{signal.throwIfAborted();if(await hooks.sourceDigest()!==input.sourceDigest)throw new Error('visual_candidate_changed');};
  const captures:any[]=[],findings:any[]=[];
  await stable();
  for(const viewport of VISUAL_VIEWPORTS){
    await stable();
    const browser=new AgentBrowser(input.origin,input.token,artifacts,signal);
    try{
      await hooks.browserStarted?.(browser.id);await browser.open({width:viewport.width,height:viewport.height});
      await browser.protectedPage(async page=>{
        for(const path of viewport.allRoutes?paths:critical){
          await hooks.prepareRoute?.(page,path);
          await stable();const response=await page.goto(input.origin+path,{waitUntil:'networkidle'});
          const observation=await browser.capture();
          const geometry=await page.evaluate<{width:number;brokenImages:Array<{src:string;alt:string}>}>(`({width:document.documentElement.scrollWidth,brokenImages:Array.from(document.images).filter(image=>{const r=image.getBoundingClientRect(),s=getComputedStyle(image);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'&&image.complete&&image.naturalWidth===0}).map(image=>({src:image.currentSrc||image.src,alt:image.alt}))})`);
          const shared={candidateRevision:input.candidateRevision,path,resolvedPath:new URL(page.url()).pathname,viewport:{name:viewport.name,width:viewport.width,height:viewport.height},
            screenshotId:observation.screenshot.id,htmlId:observation.html.id,structureId:observation.structure.id};
          captures.push({...shared,httpStatus:response?.status()??0,geometry});
          const add=(key:string,detail:string)=>findings.push({...shared,key,detail,severity:'major',requirementId:'baseline:responsive-layout',reproduction:[`Open ${path}`,`Set viewport to ${viewport.width}×${viewport.height}`]});
          if(response?.status()!==200)add('route-http-failure',`Received HTTP ${response?.status()??0}`);
          if(shared.resolvedPath.replace(/\/$/,'')!==path.replace(/\/$/,''))add('route-state-not-observed',`Requested ${path} resolved to ${shared.resolvedPath}; prepare the required state before review`);
          if(geometry.width>viewport.width+1)add('horizontal-overflow',`Document width ${geometry.width}px exceeds viewport ${viewport.width}px`);
          if(geometry.brokenImages.length)add('broken-visible-image',`${geometry.brokenImages.length} visible images failed to load`);
        }
      });
    }finally{await browser.close();}
  }
  await stable();
  return{version:1,candidateRevision:input.candidateRevision,sourceDigest:input.sourceDigest,captures,findings,
    coverage:{complete:!findings.some(item=>['route-http-failure','route-state-not-observed'].includes(item.key))},
    scope:'Deterministic capture and layout/resource defects only. Independent vision review remains required.',releaseEligible:false};
}
