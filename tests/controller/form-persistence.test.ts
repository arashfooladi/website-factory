import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {mkdtemp,mkdir,writeFile,appendFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Environments} from '../../src/environments.js';
import {AgentArtifacts} from '../../src/agent-artifacts.js';
import {checkMailForms} from '../../src/form-qa.js';
import {mailEvidence} from '../../src/mail-evidence.js';
import {FunctionalPlan} from '../../src/functional-plan.js';

test('mail forms require a scoped clone and real correlated persistence, even when a page claims success',async()=>{
 const root=await mkdtemp(join(tmpdir(),'factory-form-mail-')),id=randomUUID(),sourceEnvironmentId=randomUUID(),directory=join(root,'instances',id),sink=join(directory,'logs','mail.jsonl');await mkdir(join(directory,'logs'),{recursive:true});let persist=true,posts=0,runtimeCalls=0;
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url!,'http://fixture');
  if(req.method==='POST'){
   posts++;const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const values=new URLSearchParams(Buffer.concat(chunks).toString());
   if(persist)await appendFile(sink,JSON.stringify({to:JSON.stringify('contact@example.test'),subject:'درخواست آزمایشی',message:values.get('message')})+'\n');
   res.writeHead(303,{Location:'/thanks/'});res.end();return;
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html lang="fa"><main>${url.pathname==='/thanks/'?'ثبت شد':'<form method="post"><label for="message">پیام</label><textarea id="message" name="message"></textarea><button id="send">ثبت</button></form>'}</main></html>`);
 });await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const candidate={revision:'a'.repeat(40),sourceDigest:'b'.repeat(64),sourceEnvironmentId};
 const environments={controller:{config:{environmentRoot:root}},inspect:async()=>({status:'running',current_operation_id:null,preview_port:(server.address()as AddressInfo).port}),runtime:async()=>{runtimeCalls++;return{stdout:JSON.stringify({sha256:candidate.sourceDigest,files:{}})};}}as unknown as Environments;
 const form={id:'contact',requirementId:'contact',path:'/',expectedPath:'/thanks/',expectedText:'ثبت شد',fields:[{selector:'#message',value:'پیام فارسی {{qaToken}}'}],submit:'#send',mail:{to:'contact@example.test',messageIncludes:'پیام فارسی {{qaToken}}'}};
 try{
  await writeFile(join(directory,'private.json'),JSON.stringify({previewToken:'fixture'}));
  await assert.rejects(checkMailForms(environments,'owner',id,candidate,[form],new AgentArtifacts(join(root,'evidence'),16777216),AbortSignal.timeout(60000)),/isolated_clone_required/);assert.equal(runtimeCalls,0);assert.equal(posts,0);
  for(const visualClone of [{sourceEnvironmentId:id,sourceDigest:candidate.sourceDigest,purpose:'functional'},{sourceEnvironmentId:randomUUID(),sourceDigest:candidate.sourceDigest,purpose:'functional'},{sourceEnvironmentId,sourceDigest:'c'.repeat(64),purpose:'functional'},{sourceEnvironmentId,sourceDigest:candidate.sourceDigest,purpose:'visual'}]){
   await writeFile(join(directory,'private.json'),JSON.stringify({previewToken:'fixture',visualClone}));
   await assert.rejects(checkMailForms(environments,'owner',id,candidate,[form],new AgentArtifacts(join(root,'evidence'),16777216),AbortSignal.timeout(60000)),/isolated_clone_required/);
  }assert.equal(runtimeCalls,0);assert.equal(posts,0);
  await writeFile(join(directory,'private.json'),JSON.stringify({previewToken:'fixture',visualClone:{sourceEnvironmentId,sourceDigest:candidate.sourceDigest,purpose:'functional'}}));
  const run=()=>checkMailForms(environments,'owner',id,candidate,[form],new AgentArtifacts(join(root,'evidence'),16777216),AbortSignal.timeout(60000));
  const healthy=await run();assert.equal(healthy.requiresRepair,false);assert.equal(posts,1);
  persist=false;const falseSuccess=await run();assert.equal(falseSuccess.results[0]?.reason,'functional_form_persistence_missing');assert.equal(falseSuccess.requiresRepair,true);assert.equal(posts,2);
  assert.throws(()=>FunctionalPlan.parse({forms:[{...form,fields:[{selector:'#message',value:'no scoped token'}]}],requiredChecks:['contact']}));
  assert.throws(()=>FunctionalPlan.parse({forms:[form],engines:['firefox','firefox'],requiredChecks:['contact']}));
  assert.equal(FunctionalPlan.parse({forms:[form],requiredChecks:['contact']}).forms.length,1);
 }finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(root,{recursive:true,force:true});}
});

test('private mail sink refuses symlinks, directories and oversized data',async()=>{
 const root=await mkdtemp(join(tmpdir(),'factory-mail-guard-'));
 try{
  const target=join(root,'mail');await writeFile(target,'');await symlink(target,join(root,'link'));await assert.rejects(mailEvidence(join(root,'link')));
  await assert.rejects(mailEvidence(root),/mail_sink_invalid/);await writeFile(target,'x'.repeat(524289));await assert.rejects(mailEvidence(target),/mail_sink_invalid/);assert.deepEqual(await mailEvidence(join(root,'absent')),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});
