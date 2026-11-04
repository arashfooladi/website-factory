import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Environments} from '../../src/environments.js';
import {AgentArtifacts} from '../../src/agent-artifacts.js';
import {checkAdminProduct} from '../../src/admin-qa.js';

test('admin writes are refused before credentials/runtime access on ordinary or mismatched environments',async()=>{
 const root=await mkdtemp(join(tmpdir(),'factory-admin-guard-')),id=randomUUID();let calls=0;
 try{
  const directory=join(root,'instances',id);await mkdir(directory,{recursive:true});
  const environments={controller:{config:{environmentRoot:root}},inspect:async()=>({status:'running',current_operation_id:null}),credentials:async()=>{calls++;throw new Error('credentials_must_not_be_read');},runtime:async()=>{calls++;throw new Error('runtime_must_not_run');}}as unknown as Environments;
  const candidate={revision:'a'.repeat(40),sourceDigest:'b'.repeat(64),sourceEnvironmentId:randomUUID()},artifacts=new AgentArtifacts(join(root,'evidence'),1048576);
  for(const metadata of [{},{visualClone:{sourceEnvironmentId:id,sourceDigest:candidate.sourceDigest}},{visualClone:{sourceEnvironmentId:randomUUID(),sourceDigest:'c'.repeat(64)}},{visualClone:{sourceEnvironmentId:randomUUID(),sourceDigest:candidate.sourceDigest}}]){
   await writeFile(join(directory,'private.json'),JSON.stringify(metadata));
   await assert.rejects(checkAdminProduct(environments,'owner',id,candidate,artifacts,new AbortController().signal),/admin_qa_isolated_clone_required/);
  }
  await writeFile(join(directory,'private.json'),JSON.stringify({visualClone:{sourceEnvironmentId:candidate.sourceEnvironmentId,sourceDigest:candidate.sourceDigest,purpose:'visual'}}));
  await assert.rejects(checkAdminProduct(environments,'owner',id,{...candidate,media:true},artifacts,new AbortController().signal),/admin_qa_media_clone_required/);
  assert.equal(calls,0);assert.equal(artifacts.records.length,0);
 }finally{await rm(root,{recursive:true,force:true});}
});
