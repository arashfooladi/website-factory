import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VisualPreview} from '../../src/visual-preview.js';
import type {Controller} from '../../src/controller.js';
import type {Environments} from '../../src/environments.js';

test('QA preview records allocation before cloning and removes its private environment after failure or cancellation',async()=>{
 for(const mode of ['clone-failure','cancel-after-allocation','success','functional']){
  const abort=new AbortController(),calls:string[]=[];let status='stopped',allocated=false,expired=false;
  const review={id:'review',attempt_id:'attempt',project_id:'project',source_digest:'a'.repeat(64),input:{maxRuntimeMs:60000}};
  const controller={config:{ownerId:'owner'},pool:{query:async()=>{expired=true;return{rows:[]};}}}as unknown as Controller;
  const environments={
   create:async(_owner:string,input:any,internal:any)=>{assert.equal(input.themeBundleId,'theme');assert.equal(internal.allocationKey,'visual-review-attempt');calls.push('allocate');return{id:'qa'};},
   inspect:async(_owner:string,id:string)=>{assert.equal(id,'qa');return{id,status,current_operation_id:null};},
   runtime:async(action:string,id:string,_args:unknown,input:any)=>{assert.equal(action,'clone-visual');assert.equal(id,'qa');assert(allocated);assert.equal(input.sourceEnvironmentId,'source');assert.equal(input.purpose,mode==='functional'?'functional':'visual');calls.push('clone');if(mode==='clone-failure')throw new Error('copy_failed');return{sourceDigest:review.source_digest};},
   request:async(_owner:string,id:string,action:string,_snapshot:unknown,internal:any)=>{assert.equal(id,'qa');assert.equal(internal.visualReviewId,review.id);calls.push(action);status=action==='start'?'running':'deleted';},
  }as unknown as Environments;
  const preview=new VisualPreview(controller,environments,review,abort.signal,async(type,data)=>{assert.equal(type,'qa_environment_allocated');assert.equal(data.environmentId,'qa');allocated=true;if(mode==='cancel-after-allocation')abort.abort();},mode==='functional'?'functional':'visual');
  try{
   const opening=preview.open({id:'source',theme_bundle_id:'theme',limits:{}});
   if(mode==='success'||mode==='functional')assert.equal((await opening).environment.status,'running');else await assert.rejects(opening);
  }finally{await preview.close();await preview.close();}
  assert(expired);assert.equal(status,'deleted');assert.equal(calls.filter(c=>c==='destroy').length,1);
  if(mode==='cancel-after-allocation')assert(!calls.includes('clone'));
 }
});
