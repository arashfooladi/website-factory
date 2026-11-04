import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Controller} from '../../src/controller.js';
import {parseConfig} from '../../src/config.js';
import {VisualReviewJobs,type VisualJobProcessor} from '../../src/visual-jobs.js';
import {createApi} from '../../src/api.js';
import type {AddressInfo} from 'node:net';
import {Agents} from '../../src/agents.js';
import {Environments} from '../../src/environments.js';

const config=parseConfig({...JSON.parse(await readFile('.runtime/controller/config.test.json','utf8')),visualRoot:'.runtime/controller/visual-job-tests'});
let controller:Controller,jobs:VisualReviewJobs,candidateId:string,mode='valid',started!:()=>void,api:ReturnType<typeof createApi>,origin:string;
const processor:VisualJobProcessor={provider:'controlled-visual-test',run:async(row,artifacts,signal,usage,event)=>{
 if(mode==='cancel'||mode==='stale'){
  await event('task_started',{taskId:randomUUID()});started();
  await new Promise<void>(done=>signal.addEventListener('abort',()=>done(),{once:true}));usage.confirmed=false;signal.throwIfAborted();
 }
 if(mode==='source-changed')throw new Error('visual_candidate_changed');
 await artifacts.save('visual_capture_report','application/json','{"fixture":true}');
 usage.totalTokens=mode==='over-budget'?1200:20;usage.confirmed=mode!=='unknown';
 return{candidateRevision:mode==='wrong-candidate'?'f'.repeat(40):row.candidate_revision,sourceDigest:row.source_digest,releaseEligible:false,requiresRepair:true};
}};
async function done(id:string){const end=Date.now()+60000;while(Date.now()<end){const row=await jobs.inspect(config.ownerId,id);if(!['queued','running','cancelling'].includes(row.status))return row;await new Promise(r=>setTimeout(r,150));}throw new Error('visual_job_test_timeout');}
before(async()=>{
 assert(new URL(config.databaseUrl).pathname.endsWith('_test'));controller=await new Controller(config).open();
 const projectId=(await controller.createProject(config.ownerId,{name:'Visual queue fixture'})).id,intakeId=randomUUID(),environmentId=randomUUID();candidateId=randomUUID();
 await controller.pool.query("INSERT INTO factory.intakes(id,project_id,revision,status,brief,brief_sha256,baseline_sha256) VALUES($1,$2,1,'completed','{}',$3,$3)",[intakeId,projectId,'a'.repeat(64)]);
 await controller.pool.query("INSERT INTO factory.environments(id,project_id,status,limits,preview_port) VALUES($1,$2,'deleted','{}',16999)",[environmentId,projectId]);
 await controller.pool.query(`INSERT INTO factory.agent_runs(id,project_id,environment_id,session_key,provider,model,role,prompt,status,instructions_sha256,skill_versions,limits,intake_id,candidate_revision,source_digest)
 VALUES($1,$2,$3,$4,'fixture','fixture','builder','Fixture only','completed',$5,'{}','{}',$6,$7,$8)`,[candidateId,projectId,environmentId,randomUUID(),'a'.repeat(64),intakeId,'b'.repeat(40),'c'.repeat(64)]);
 jobs=await new VisualReviewJobs(controller,processor).open();
 api=createApi(controller,undefined,undefined,undefined,undefined,undefined,undefined,jobs);await new Promise<void>(done=>api.listen(0,'127.0.0.1',done));origin=`http://127.0.0.1:${(api.address()as AddressInfo).port}`;
});
after(async()=>{if(api){api.closeAllConnections();await new Promise<void>(done=>api.close(()=>done()));}if(jobs)await jobs.close();if(controller)await controller.close();});
test('durable owned review records preserve defects without granting release and protect artifact hashes',async()=>{
 const headers={Authorization:`Bearer ${config.apiToken}`,'Content-Type':'application/json'};
 assert.equal((await fetch(origin+'/v1/visual-reviews/'+randomUUID())).status,401);
 const response=await fetch(origin+'/v1/visual-reviews',{method:'POST',headers,body:JSON.stringify({candidateRunId:candidateId})});assert.equal(response.status,202);
 const created=await response.json()as any;const row=await done(created.id);
 assert.equal((await fetch(origin+'/v1/visual-reviews/'+created.id,{headers})).status,200);
 const download=await fetch(origin+'/v1/visual-reviews/'+created.id+'/artifacts/'+row.artifacts[0].id,{headers});assert.equal(download.status,200);assert.match(download.headers.get('content-disposition')!,/^attachment/);
 assert.equal(row.status,'reviewed',row.reason);assert.equal(row.report.requiresRepair,true);assert.equal(row.releaseEligible,false);assert.equal(row.usage.confirmed,true);
 await assert.rejects(jobs.create(config.ownerId,{candidateRunId:candidateId,reuseCaptureReviewId:row.id}),/visual_reuse_capture_missing/);
 await assert.rejects(jobs.create(config.ownerId,{candidateRunId:candidateId,reuseCaptureReviewId:randomUUID()}),/not_found/);
 await assert.rejects(jobs.inspect(randomUUID(),row.id),/not_found/);await assert.rejects(jobs.create(randomUUID(),{candidateRunId:candidateId}),/not_found/);
 const id=row.artifacts[0].id,artifact=await jobs.artifact(config.ownerId,row.id,id);
 const file=join(config.visualRoot,row.id,row.attempt_id,'artifacts',id);
 try{await writeFile(file,'tampered');await assert.rejects(jobs.artifact(config.ownerId,row.id,id),/artifact_hash_mismatch/);}finally{await writeFile(file,artifact.bytes);}
});
test('unknown usage, observed overruns, changed source and wrong candidate reports cannot finish a review',async()=>{
 for(const [next,reason]of [['unknown','visual_review_budget_exceeded'],['over-budget','visual_review_budget_exceeded'],['source-changed','visual_candidate_changed'],['wrong-candidate','visual_review_result_invalid']]){
  mode=next!;const row=await done((await jobs.create(config.ownerId,{candidateRunId:candidateId,maxObservedTokens:1000})).id);
  assert.equal(row.status,'needs_review');assert.equal(row.reason,reason);assert.equal(row.report,null);
 }mode='valid';
});
test('cancellation drains processing and active review creation is unique',async()=>{
 mode='cancel';const ready=new Promise<void>(done=>{started=done;});const created=await jobs.create(config.ownerId,{candidateRunId:candidateId});await ready;
 await assert.rejects(jobs.create(config.ownerId,{candidateRunId:candidateId}),/visual_review_active/);
 const candidate=(await controller.pool.query('SELECT * FROM factory.agent_runs WHERE id=$1',[candidateId])).rows[0];
 await controller.pool.query("UPDATE factory.environments SET status='running' WHERE id=$1",[candidate.environment_id]);
 const qaId=randomUUID();await controller.pool.query("INSERT INTO factory.environments(id,project_id,status,limits,preview_port) VALUES($1,$2,'running','{}',17000)",[qaId,candidate.project_id]);
 await controller.pool.query('UPDATE factory.visual_reviews SET qa_environment_id=$2 WHERE id=$1',[created.id,qaId]);
 try{
  for(const id of [candidate.environment_id,qaId]){
   const environments=new Environments(controller);
   await assert.rejects(new Agents(controller,environments).create(config.ownerId,{environmentId:id,intakeId:candidate.intake_id,role:'builder',prompt:'Do not edit a source while visual review is active.'}),/visual_review_active/);
   await assert.rejects(environments.request(config.ownerId,id,'stop'),/visual_review_active/);
  }
 }finally{await controller.pool.query("UPDATE factory.environments SET status='deleted' WHERE id=ANY($1::uuid[])",[[candidate.environment_id,qaId]]);}
 await jobs.cancel(config.ownerId,created.id);const row=await done(created.id);assert.equal(row.status,'cancelled');assert.equal(row.report,null);assert.equal(row.usage.confirmed,false);mode='valid';
});
test('expired leases fence stale publication and restart retains terminal review records',async()=>{
 mode='stale';const ready=new Promise<void>(done=>{started=done;});const created=await jobs.create(config.ownerId,{candidateRunId:candidateId});await ready;
 await controller.pool.query("UPDATE factory.visual_reviews SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[created.id]);
 await jobs.recover();const row=await done(created.id);assert.equal(row.status,'needs_review');assert.equal(row.reason,'visual_worker_interrupted');assert.equal(row.report,null);
 await jobs.close();jobs=await new VisualReviewJobs(controller,processor).open();assert.equal((await jobs.inspect(config.ownerId,row.id)).status,'needs_review');mode='valid';
});
