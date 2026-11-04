import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {parseConfig} from '../../src/config.js';
import {AgentArtifacts} from '../../src/agent-artifacts.js';
import {AgentBrowser} from '../../src/agent-browser.js';
import {VisualReviewEvidence} from '../../src/visual-review.js';
import {assessVisualCaptures} from '../../src/visual-assessment.js';
import {CodexAdapter} from '../../src/codex-adapter.js';
import type {ProviderUsage} from '../../src/agent-contracts.js';
import type {FidelitySource} from '../../src/visual-fidelity.js';

// Explicit real-provider benchmark. Same visual difference, two different client policies.
test('real vision comparison flags a strict palette mismatch while allowing a requested semi-copy adaptation',async()=>{
 const config=parseConfig(JSON.parse(await readFile('.runtime/controller/config.test.json','utf8'))),id=randomUUID();
 const root=`.runtime/controller/visual-fidelity-agent-tests/${id}`,artifacts=new AgentArtifacts(root,67108864,'a'.repeat(40));
 const abort=new AbortController(),deadline=setTimeout(()=>abort.abort(),540000);
 const server=createServer((request,response)=>{
  const accent=request.url==='/reference/'?'#1736bb':'#bd4b22';response.setHeader('Content-Type','text/html; charset=utf-8');
  response.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  *{box-sizing:border-box}body{margin:0;background:#f6f4ee;color:#243024;font:18px Georgia,serif}header{padding:24px;border-bottom:1px solid #b8b8af}
  main{padding:28px}section{padding:40px 28px;background:${accent};color:white}h1{font-size:42px;line-height:1.1;margin:8px 0 24px;max-width:14ch}
  p{max-width:42ch;line-height:1.5}button{padding:14px 20px;border:1px solid currentColor;background:transparent;color:inherit;font:inherit}
  </style><header>Field Notes / Journal</header><main><section><h1>A quieter place to read.</h1><p>Notes on the land, the seasons and the people who care for them.</p><button>Read the journal</button></section></main></html>`);
 });await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const origin=`http://127.0.0.1:${(server.address()as AddressInfo).port}`;
 const captures:Array<{path:string;viewport:{name:string;width:number;height:number};screenshotId:string;htmlId:string;structureId:string}>=[],states:any[]=[],refCaptures:typeof captures=[];
 try{
  for(const viewport of [{name:'desktop',width:1280,height:900},{name:'mobile',width:390,height:844}]){
   const browser=new AgentBrowser(origin,'probe',artifacts,abort.signal);
   try{
    await browser.open(viewport);
    for(const path of ['/','/reference/']){
     const after=(await browser.act({action:'navigate',path})).after;
     const capture={path,viewport,screenshotId:after.screenshot.id,htmlId:after.html.id,structureId:after.structure.id};
     if(path==='/')captures.push(capture);else{refCaptures.push(capture);states.push({stateId:after.stateId,path:origin+path,requestedUrl:origin+path,purpose:'route-initial',viewport,summary:{httpStatus:200},screenshot:after.screenshot,html:after.html,structure:after.structure});}
    }
   }finally{await browser.close();}
  }
  const refEvidence=new VisualReviewEvidence({candidateRevision:'c'.repeat(40),sourceDigest:'d'.repeat(64),captures:refCaptures},artifacts,new Set());
  const reference={invoke:async(raw:unknown)=>{
   const input=raw as{action:string;stateId:string};assert.equal(input.action,'state');const state=states.find(s=>s.stateId===input.stateId);assert(state);
   const evidence=await refEvidence.capture(state.structure.id);
   return{success:true,contentItems:[{type:'inputText' as const,text:JSON.stringify({state,html:evidence.html,structure:evidence.structure})},{type:'inputImage' as const,imageUrl:evidence.image}]};
  }};
  for(const mode of ['replica','semi-replica']as const){
   const fidelity:FidelitySource={brief:{mode,referenceUrls:[origin+'/reference/'],pages:[{path:'/',referenceUrl:origin+'/reference/'}],
    design:mode==='semi-replica'?{instructions:'Use the client orange accent #bd4b22 in place of the reference accent. Keep the reference layout and hierarchy.'}:{}},states};
   const usage:ProviderUsage={inputTokens:0,cachedInputTokens:0,outputTokens:0,totalTokens:0,costMicros:null,confirmed:true};
   const result=await assessVisualCaptures({candidateRevision:'a'.repeat(40),sourceDigest:'b'.repeat(64),coverage:{complete:true},captures},artifacts,new CodexAdapter(config),{
    model:config.codexModel,instructions:'Review visual quality and fidelity against the protected per-page client policy. Identify only concrete evidence-backed defects; respect permitted adaptations and do not invent unrelated criticism.',
    requirements:['baseline:responsive-layout'],maxObservedTokens:80000,fidelity,reference},abort.signal,usage,async()=>{});
   await writeFile(`${root}/${mode}-result.json`,JSON.stringify({id,mode,result,usage}),{mode:0o600});
   assert.equal(result.coverageComplete,true);assert.equal(result.visualReferenceComparisonComplete,true);assert.equal(result.releaseEligible,false);assert(usage.confirmed);
   const comparisons=result.reviews.flatMap(review=>review.fidelity.comparisons);
   const palette=comparisons.filter(c=>c.axis==='palette');assert.equal(palette.length,2);
   assert(palette.every(c=>c.reference.screenshot.id&&c.reference.html.id));
   if(mode==='replica'){assert(palette.every(c=>c.verdict==='defect'),'Strict copy must catch the different accent palette in both viewports');assert.equal(result.requiresRepair,true);}
   else assert(palette.every(c=>c.verdict==='satisfied'),'Requested semi-copy palette adaptation must be accepted in both viewports');
  }
 }finally{clearTimeout(deadline);server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});
