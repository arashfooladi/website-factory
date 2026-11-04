import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseConfig} from '../../src/config.js';
import {AgentBrowser} from '../../src/agent-browser.js';
import {AgentArtifacts} from '../../src/agent-artifacts.js';
import {CodexAdapter} from '../../src/codex-adapter.js';
import {assessVisualCaptures} from '../../src/visual-assessment.js';
import type {ProviderUsage} from '../../src/agent-contracts.js';

// Explicit opt-in: invokes the real provider. Never included in the ordinary local check.
test('real independent vision reviewer catches a short-landscape defect using paired evidence',async()=>{
 const config=parseConfig(JSON.parse(await readFile('.runtime/controller/config.test.json','utf8')));
 const runId=randomUUID(),root=`.runtime/controller/visual-agent-tests/${runId}`;
 const artifacts=new AgentArtifacts(root,33554432,'a'.repeat(40)),abort=new AbortController();
 const deadline=setTimeout(()=>abort.abort(),240000);
 const server=createServer((_request,response)=>{
  response.setHeader('Content-Type','text/html');
  response.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
   *{box-sizing:border-box}body{margin:0;background:#f5f2eb;color:#202c24;font:18px Georgia,serif}
   header,main{padding:32px}header{border-bottom:1px solid #aaa}h1{font-size:48px;margin:12px 0}
   article{width:min(100%,720px);padding:24px;background:white}button{padding:16px;background:#234e36;color:white;border:0}
   @media(max-height:400px) and (min-width:700px){article{width:1600px;min-width:1600px}.actions{position:absolute;left:1360px;top:160px}}
   </style><header>Field Notes / Journal</header><main><h1>A quieter place to read.</h1><article><h2>Notes from the orchard</h2><p>Stories about land, seasons, and the people who care for them.</p><div class="actions"><button>Read the journal</button></div></article></main></html>`);
 });
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const origin=`http://127.0.0.1:${(server.address()as AddressInfo).port}`;
 const captures:Array<{path:string;viewport:{name:string;width:number;height:number};screenshotId:string;htmlId:string;structureId:string}>=[];
 try{
  for(const viewport of [{name:'desktop',width:1280,height:900},{name:'landscape',width:844,height:390}]){
   const browser=new AgentBrowser(origin,'probe',artifacts,abort.signal);
   try{await browser.open(viewport);const observed=await browser.act({action:'navigate',path:'/'});
    captures.push({path:'/',viewport,screenshotId:observed.after.screenshot.id,htmlId:observed.after.html.id,structureId:observed.after.structure.id});
   }finally{await browser.close();}
  }
  const usage:ProviderUsage={inputTokens:0,cachedInputTokens:0,outputTokens:0,totalTokens:0,costMicros:null,confirmed:true};
  const result=await assessVisualCaptures({candidateRevision:'a'.repeat(40),sourceDigest:'b'.repeat(64),coverage:{complete:true},captures},artifacts,new CodexAdapter(config),{
   model:config.codexModel,instructions:'Assess responsive layout and readable, accessible presentation. Identify concrete defects from the evidence. Do not manufacture criticism of the healthy desktop state. Functional testing is outside this task.',
   requirements:['baseline:responsive-layout'],maxObservedTokens:60000},abort.signal,usage,async()=>{});
  await mkdir(root,{recursive:true});await writeFile(`${root}/result.json`,JSON.stringify({runId,result,usage}),{mode:0o600});
  assert.equal(result.coverageComplete,true);assert.equal(result.requiresRepair,true);assert.equal(result.releaseEligible,false);assert(usage.confirmed);
  const findings=result.reviews.flatMap(review=>review.findings);
  assert(findings.some(finding=>finding.captureId===captures[1]!.structureId&&['blocker','major'].includes(finding.severity)&&/overflow|clipp|off.?screen|outside|wide|horizontal|cropp/i.test(finding.detail)),'Reviewer must report the introduced landscape clipping/overflow against the landscape evidence');
  assert(!findings.some(finding=>finding.captureId===captures[0]!.structureId&&/overflow|off.?screen|horizontal/i.test(finding.detail)),'Do not misattribute the landscape defect to the healthy desktop capture');
 }finally{clearTimeout(deadline);server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});
