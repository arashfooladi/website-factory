import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentArtifacts} from '../../src/agent-artifacts.js';
import {captureContentStress} from '../../src/visual-stress.js';

test('synthetic RTL/long content exposes nowrap overflow, labels evidence and leaves served content unchanged',async()=>{
 const root=await mkdtemp(join(tmpdir(),'factory-stress-'));
 const original='<style>body{margin:0}h1{font:24px sans-serif;white-space:nowrap}</style><main><h1>Short title</h1></main>';
 const server=createServer((request,response)=>{assert.equal(request.headers.authorization,'Bearer probe');response.setHeader('Content-Type','text/html; charset=utf-8');response.end(original);});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const input={origin:`http://127.0.0.1:${(server.address()as AddressInfo).port}`,token:'probe',candidateRevision:'a'.repeat(40),sourceDigest:'b'.repeat(64),paths:['/']};
 try{
  const artifacts=new AgentArtifacts(root,16777216),report=await captureContentStress(input,artifacts,new AbortController().signal,{sourceDigest:async()=>input.sourceDigest});
  assert.equal(report.captures.length,2);assert.equal(report.findings.filter(f=>f.key==='horizontal-overflow').length,2);assert.equal(report.coverage.complete,true);
  for(const capture of report.captures){assert.equal(capture.scenario,'synthetic-rtl-long-headings-v1');assert.equal(capture.changedHeadings,1);assert(artifacts.records.some(a=>a.id===capture.htmlId));}
  assert.equal(await(await fetch(input.origin,{headers:{Authorization:'Bearer probe'}})).text(),original);
  await assert.rejects(captureContentStress(input,artifacts,new AbortController().signal,{sourceDigest:async()=>'c'.repeat(64)}),/visual_candidate_changed/);
 }finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(root,{recursive:true,force:true});}
});
