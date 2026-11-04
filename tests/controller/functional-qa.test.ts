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

test('filters, keyboard activation and persisted forms reject decorative controls and false success',async()=>{
 const root=await mkdtemp(join(tmpdir(),'factory-functional-extended-'));let broken=false,submitted=false,posts=0;
 const server=createServer(async(request,response)=>{
  const url=new URL(request.url!,'http://fixture');if(request.method==='POST'){posts++;for await(const _ of request){}submitted=!broken;response.writeHead(303,{Location:'/thanks/'});response.end();return;}
  response.setHeader('Content-Type','text/html; charset=utf-8');
  response.end(`<html lang="fa"><body><main><a id="go" ${broken?'tabindex="-1"':''} href="/thanks/">Continue</a>
  <select id="filter" aria-label="Category" onchange="${broken?'':'document.querySelector(\'#other\').remove()'}"><option value="all">All</option><option value="prints">Prints</option></select><p>چاپ</p><p id="other">دفتر</p>
  <form method="post" action="/submit/"><label for="name">نام</label><input id="name" name="name" required><button id="send">Send</button></form>${url.pathname==='/thanks/'?'ثبت شد':''}</main></body></html>`);
 });await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const checks:FunctionalCheck[]=[{id:'filter',requirementId:'filter',kind:'filter',path:'/',selector:'#filter',value:'prints',expectedText:'چاپ',excludedText:'دفتر'},
 {id:'keyboard',requirementId:'keyboard',kind:'keyboard',path:'/',target:'#go',expectedPath:'/thanks/',expectedText:'ثبت شد',maxTabs:6},
 {id:'contact',requirementId:'contact',kind:'form',path:'/',fields:[{selector:'#name',value:'آزمایش فارسی'}],submit:'#send',expectedPath:'/thanks/',expectedText:'ثبت شد'}];
 const input={origin:`http://127.0.0.1:${(server.address()as AddressInfo).port}`,token:'fixture',candidateRevision:'a'.repeat(40),sourceDigest:'b'.repeat(64),checks},artifacts=new AgentArtifacts(root,67108864);
 const run=()=>checkFunctionalJourneys(input,artifacts,AbortSignal.timeout(120000),{sourceDigest:async()=>input.sourceDigest,allowMutation:true,verifyForm:async()=>submitted});
 try{
  const denied=await checkFunctionalJourneys({...input,checks:[checks[2]!] },artifacts,AbortSignal.timeout(30000),{sourceDigest:async()=>input.sourceDigest});assert.equal(denied.results[0]?.reason,'functional_form_oracle_required');assert.equal(posts,0);
  const healthy=await run();assert.equal(healthy.requiresRepair,false,JSON.stringify(healthy.results.map(r=>({id:r.checkId,reason:r.reason}))));
  broken=true;submitted=false;const defects=await run();assert(defects.results.every(r=>!r.passed&&r.after));assert.equal(defects.results[2]?.reason,'functional_form_persistence_missing');
 }finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(root,{recursive:true,force:true});}
});
