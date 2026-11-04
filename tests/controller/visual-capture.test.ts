import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import {captureVisualMatrix,VISUAL_VIEWPORTS} from '../../src/visual-capture.js';
import {AgentArtifacts} from '../../src/agent-artifacts.js';

test('visual capture catches an awkward-ratio defect and broken artwork, preserves evidence and fences changed candidates',async()=>{
 const root=await mkdtemp(join(tmpdir(),'factory-visual-'));
 const server=createServer((request,response)=>{
  assert.equal(request.headers.authorization,'Bearer visual-fixture');
  if(request.url==='/redirect/'){response.writeHead(302,{Location:'/healthy/'});response.end();return;}
  if(request.url==='/missing.png'){response.writeHead(404);response.end();return;}
  response.setHeader('Content-Type','text/html; charset=utf-8');response.end(`<!doctype html><title>Visual fixture</title><style>body{margin:0;padding:16px}*{box-sizing:border-box}main{max-width:100%}${request.url==='/broken/'?'@media(min-width:800px) and (max-height:400px){main{width:1600px;max-width:none}}':''}</style><main><h1>Original print catalog</h1>${request.url==='/broken/'?'<img src="/missing.png" width="120" height="160" alt="Artwork">':'<p>Healthy content wraps at narrow sizes.</p>'}</main>`);
 });await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const origin=`http://127.0.0.1:${(server.address()as AddressInfo).port}`,digest='a'.repeat(64),revision='b'.repeat(40);
 const input={origin,token:'visual-fixture',candidateRevision:revision,sourceDigest:digest,paths:['/healthy/','/broken/','/redirect/'],criticalPaths:['/healthy/','/broken/','/redirect/']};
 try{
  const artifacts=new AgentArtifacts(root,67108864),report=await captureVisualMatrix(input,artifacts,new AbortController().signal,{sourceDigest:async()=>digest});
  assert.equal(report.captures.length,VISUAL_VIEWPORTS.length*3);assert(!report.findings.some(item=>item.path==='/healthy/'));
  assert.equal(report.coverage.complete,false);assert(report.findings.some(item=>item.key==='route-state-not-observed'&&item.path==='/redirect/'));
  assert(report.findings.some(item=>item.key==='horizontal-overflow'&&item.viewport.name==='landscape'));
  assert(report.findings.some(item=>item.key==='broken-visible-image'));
  for(const finding of report.findings){assert.equal(finding.candidateRevision,revision);assert(artifacts.records.some(item=>item.id===finding.screenshotId));assert(finding.reproduction.length===2);}
  await assert.rejects(captureVisualMatrix(input,artifacts,new AbortController().signal,{sourceDigest:async()=>'c'.repeat(64)}),/visual_candidate_changed/);
 }finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(root,{recursive:true,force:true});}
});
