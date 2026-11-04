import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentArtifacts} from '../../src/agent-artifacts.js';
import {captureBreakpointSweep,BREAKPOINT_WIDTHS} from '../../src/visual-breakpoints.js';

test('breakpoint sweep detects a defect between matrix widths and fences changing source',async()=>{
 const root=await mkdtemp(join(tmpdir(),'factory-breakpoints-'));
 const server=createServer((request,response)=>{assert.equal(request.headers.authorization,'Bearer probe');response.setHeader('Content-Type','text/html');response.end('<style>body{margin:0}main{width:100%}@media(min-width:767px) and (max-width:769px){main{width:1200px}}</style><main>Breakpoint fixture</main>');});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const input={origin:`http://127.0.0.1:${(server.address()as AddressInfo).port}`,token:'probe',candidateRevision:'a'.repeat(40),sourceDigest:'b'.repeat(64),paths:['/']};
 try{
  const artifacts=new AgentArtifacts(root,16777216),report=await captureBreakpointSweep(input,artifacts,new AbortController().signal,{sourceDigest:async()=>input.sourceDigest});
  assert.equal(report.samples.length,BREAKPOINT_WIDTHS.length);assert.equal(report.findings.length,3);assert.equal(report.coverage.complete,true);assert.equal(report.releaseEligible,false);
  assert.deepEqual(report.findings.map(f=>f.viewport.width),[767,768,769]);
  for(const finding of report.findings){assert.equal(finding.key,'horizontal-overflow');assert(artifacts.records.some(a=>a.id===finding.screenshotId));assert(artifacts.records.some(a=>a.id===finding.htmlId));}
  let checks=0;await assert.rejects(captureBreakpointSweep(input,artifacts,new AbortController().signal,{sourceDigest:async()=>++checks<4?input.sourceDigest:'c'.repeat(64)}),/visual_candidate_changed/);
 }finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(root,{recursive:true,force:true});}
});
