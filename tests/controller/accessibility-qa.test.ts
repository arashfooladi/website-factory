import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentArtifacts} from '../../src/agent-artifacts.js';
import {checkAccessibility} from '../../src/accessibility-qa.js';

test('automated accessibility stores paired evidence and catches missing control names',async()=>{
 let broken=false,redirect=false;const server=createServer((req,res)=>{if(redirect&&req.url==='/'){res.writeHead(302,{Location:'/wrong/'});res.end();return;}res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html lang="fa" dir="rtl"><head><title>آزمایش</title></head><body><main><h1>فروشگاه</h1><form><label for="name">نام</label><input id="name" name="name"><button>${broken?'':'ثبت'}</button></form></main></body></html>`);});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const root=await mkdtemp(join(tmpdir(),'factory-axe-'));
 const input={origin:`http://127.0.0.1:${(server.address()as AddressInfo).port}`,token:'fixture',candidateRevision:'a'.repeat(40),sourceDigest:'b'.repeat(64),paths:['/']};
 try{
  const run=()=>checkAccessibility(input,new AgentArtifacts(root,67108864),AbortSignal.timeout(120000),{sourceDigest:async()=>input.sourceDigest});
  const healthy=await run();assert.equal(healthy.requiresReview,false,JSON.stringify(healthy.results.map(r=>({reason:r.reason,rules:r.violations.map(v=>v.id),incomplete:r.incomplete.map(v=>v.id)}))));
  broken=true;const failed=await run();assert(failed.results.every(r=>!r.passed&&r.evidence&&r.violations.some(v=>v.id==='button-name')));assert.equal(failed.releaseEligible,false);
  redirect=true;const wrongRoute=await run();assert(wrongRoute.results.every(r=>r.reason==='accessibility_qa_redirected_route'&&r.evidence));
 }finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(root,{recursive:true,force:true});}
});
