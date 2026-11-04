import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentArtifacts} from '../../src/agent-artifacts.js';
import {checkFunctionalJourneys,type FunctionalCheck} from '../../src/functional-qa.js';

test('functional checks distinguish real navigation/Persian search results from plausible broken pages',async()=>{
 let broken=false,post=false,posts=0;const root=await mkdtemp(join(tmpdir(),'factory-functional-'));
 const server=createServer((request,response)=>{
  assert.equal(request.headers.authorization,'Bearer fixture');if(request.method==='POST')posts++;const url=new URL(request.url!,'http://fixture');
  response.setHeader('Content-Type','text/html; charset=utf-8');
  const text=url.searchParams.has('s')?(broken||url.searchParams.get('s')==='دفتر سطر'?'دفتر سطر':'No products found'):url.pathname==='/shop/'?'Product catalog':'Home';
  response.end(`<html lang="fa"><a href="${broken?'/wrong/':'/shop/'}">Shop</a><form method="${post?'post':'get'}"><input name="s" type="search" aria-label="Search"></form><main>${text}</main></html>`);
 });await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const checks:FunctionalCheck[]=[{id:'nav',requirementId:'navigation',kind:'navigation',path:'/',linkText:'Shop',expectedPath:'/shop/',expectedText:'Product catalog'},
  {id:'search',requirementId:'search',kind:'search',path:'/',query:'دفتر سطر',expectedText:'دفتر سطر'},
  {id:'search-empty',requirementId:'search',kind:'search',path:'/',query:'ناموجود-987654',expectedText:'No products found'}];
 const input={origin:`http://127.0.0.1:${(server.address()as AddressInfo).port}`,token:'fixture',candidateRevision:'a'.repeat(40),sourceDigest:'b'.repeat(64),checks};
 try{
  const artifacts=new AgentArtifacts(root,33554432),run=()=>checkFunctionalJourneys(input,artifacts,new AbortController().signal,{sourceDigest:async()=>input.sourceDigest});
  const healthy=await run();assert.equal(healthy.requiresRepair,false);assert(healthy.results.every(r=>r.passed&&r.before&&r.after));
  broken=true;const failed=await run();assert.equal(failed.requiresRepair,true);assert.deepEqual(failed.results.map(r=>r.reason),['functional_link_target_wrong',null,'functional_expected_content_missing']);
  assert(failed.results.every(r=>r.after&&artifacts.records.some(a=>a.id===r.after!.screenshot.id)));assert.equal(failed.releaseEligible,false);
  broken=false;post=true;const unsupported=await checkFunctionalJourneys({...input,checks:[checks[1]!] },artifacts,new AbortController().signal,{sourceDigest:async()=>input.sourceDigest});assert.equal(unsupported.results[0]!.reason,'functional_search_form_contract_wrong');assert.equal(posts,0);
  await assert.rejects(checkFunctionalJourneys(input,artifacts,new AbortController().signal,{sourceDigest:async()=>'c'.repeat(64)}),/functional_candidate_changed/);
 }finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(root,{recursive:true,force:true});}
});
