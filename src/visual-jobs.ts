import {randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {z} from 'zod';
import {Controller,ControllerError} from './controller.js';
import {transaction} from './database.js';
import {AgentArtifacts} from './agent-artifacts.js';
import type {ProviderUsage} from './agent-contracts.js';
import {canonicalJson,sha256} from './immutable.js';

export const VisualJobInput=z.object({candidateRunId:z.uuid(),reuseCaptureReviewId:z.uuid().optional(),maxRuntimeMs:z.number().int().min(10000).max(3600000).default(1800000),
 maxObservedTokens:z.number().int().min(1000).max(3000000).default(1000000)}).strict();
export type VisualJobProcessor={provider:string;run:(row:any,artifacts:AgentArtifacts,signal:AbortSignal,usage:ProviderUsage,event:(type:string,data:Record<string,unknown>)=>Promise<void>)=>Promise<unknown>};
const exec=promisify(execFile);
export class VisualReviewJobs{
 private active=new Map<string,AbortController>();private registration?:string;private timer?:ReturnType<typeof setInterval>;private checking:Promise<unknown>|null=null;
 private key:string;private queue:string;
 constructor(readonly controller:Controller,readonly processor:VisualJobProcessor){this.key=sha256(controller.config.visualRoot);this.queue='factory-visual-'+this.key.slice(0,16);}
 private directory(id:string,attempt:string){return join(this.controller.config.visualRoot,id,attempt,'artifacts');}
 async open(){await mkdir(this.controller.config.visualRoot,{recursive:true,mode:0o700});
  await this.controller.boss.createQueue(this.queue,{retryLimit:0,expireInSeconds:3660,retentionSeconds:86400});await this.recover();
  this.registration=await this.controller.boss.work<{id:string}>(this.queue,{pollingIntervalSeconds:0.5,localConcurrency:1},async jobs=>{for(const job of jobs)await this.perform(job.data.id);});
  this.timer=setInterval(()=>{if(!this.checking)this.checking=this.recover().catch(()=>console.error('{"event":"visual_recovery_failed"}')).finally(()=>this.checking=null);},5000);return this;
 }
 async close(){clearInterval(this.timer);for(const abort of this.active.values())abort.abort('controller_shutdown');if(this.checking)await this.checking;if(this.registration)await this.controller.boss.offWork(this.queue,{id:this.registration,wait:true});}
 async create(owner:string,raw:unknown){const input=VisualJobInput.parse(raw);
  return transaction(this.controller.pool,async client=>{
   const candidate=(await client.query(`SELECT r.* FROM factory.agent_runs r JOIN factory.projects p ON p.id=r.project_id WHERE r.id=$1 AND p.owner_id=$2`,[input.candidateRunId,owner])).rows[0];
   if(!candidate)throw new ControllerError('not_found',404);
   if(candidate.status!=='completed'||candidate.role!=='builder'||!candidate.environment_id||!candidate.candidate_revision||!candidate.source_digest||!candidate.intake_id)throw new ControllerError('visual_published_candidate_required');
   if(input.reuseCaptureReviewId){
    const previous=(await client.query(`SELECT v.* FROM factory.visual_reviews v JOIN factory.projects p ON p.id=v.project_id WHERE v.id=$1 AND p.owner_id=$2`,[input.reuseCaptureReviewId,owner])).rows[0];
    if(!previous)throw new ControllerError('not_found',404);
    if(previous.candidate_run_id!==candidate.id||previous.candidate_revision!==candidate.candidate_revision||previous.source_digest!==candidate.source_digest||previous.storage_key!==this.key)throw new ControllerError('visual_reuse_candidate_mismatch');
    if(['queued','running','cancelling'].includes(previous.status))throw new ControllerError('visual_reuse_requires_terminal_review');
    for(const kind of ['visual_capture_report','visual_breakpoint_report','visual_stress_report','visual_preview_provenance'])if(previous.artifacts.filter((a:any)=>a.kind===kind).length!==1)throw new ControllerError('visual_reuse_capture_missing');
   }
   await client.query('SELECT id FROM factory.environments WHERE id=$1 FOR UPDATE',[candidate.environment_id]);
   if((await client.query("SELECT 1 FROM factory.agent_runs WHERE environment_id=$1 AND status IN ('queued','running','cancelling')",[candidate.environment_id])).rowCount)throw new ControllerError('visual_environment_busy');
   if((await client.query("SELECT 1 FROM factory.visual_reviews v JOIN factory.agent_runs r ON r.id=v.candidate_run_id WHERE r.environment_id=$1 AND v.status IN ('queued','running','cancelling')",[candidate.environment_id])).rowCount)throw new ControllerError('visual_review_active');
   if((await client.query("SELECT 1 FROM factory.visual_reviews WHERE candidate_run_id=$1 AND status IN ('queued','running','cancelling')",[candidate.id])).rowCount)throw new ControllerError('visual_review_active');
   const id=randomUUID();await client.query(`INSERT INTO factory.visual_reviews(id,project_id,candidate_run_id,candidate_revision,source_digest,storage_key,status,input,input_sha256,provider,model)
    VALUES($1,$2,$3,$4,$5,$6,'queued',$7,$8,$9,$10)`,[id,candidate.project_id,candidate.id,candidate.candidate_revision,candidate.source_digest,this.key,input,sha256(canonicalJson(input)),this.processor.provider,this.controller.config.codexModel]);
   await this.controller.boss.send(this.queue,{id},{db:{executeSql:(text,values)=>client.query(text,values)}});return{id,status:'queued',releaseEligible:false};
  });
 }
 async inspect(owner:string,id:string){const row=(await this.controller.pool.query(`SELECT r.* FROM factory.visual_reviews r JOIN factory.projects p ON p.id=r.project_id WHERE r.id=$1 AND p.owner_id=$2`,[id,owner])).rows[0];
  if(!row)throw new ControllerError('not_found',404);return{...row,releaseEligible:false,events:(await this.controller.pool.query('SELECT type,data,at FROM factory.visual_review_events WHERE review_id=$1 ORDER BY id',[id])).rows};
 }
 async artifact(owner:string,id:string,artifactId:string){const row=await this.inspect(owner,id);if(row.storage_key!==this.key)throw new ControllerError('visual_storage_mismatch');
  const metadata=row.artifacts.find((item:any)=>item.id===artifactId);if(!metadata||!row.attempt_id)throw new ControllerError('not_found',404);
  const bytes=await readFile(join(this.directory(id,row.attempt_id),artifactId));if(sha256(bytes)!==metadata.sha256)throw new ControllerError('artifact_hash_mismatch');return{metadata,bytes};
 }
 async cancel(owner:string,id:string){await this.inspect(owner,id);await this.controller.pool.query(`UPDATE factory.visual_reviews SET status=CASE WHEN status='queued' THEN 'cancelled' ELSE 'cancelling' END,reason='user_cancelled' WHERE id=$1 AND status IN ('queued','running','cancelling')`,[id]);
  this.active.get(id)?.abort('user_cancelled');return{id,status:(await this.inspect(owner,id)).status};
 }
 private async stop(row:any){
  if(row.active_task_id)await exec('python3',[resolve('tools/agent_sandbox.py'),'stop',row.active_task_id],{env:{...process.env,FACTORY_AGENT_ROOT:this.controller.config.agentRoot},timeout:25000}).catch(()=>{});
  if(row.browser_id)await exec('systemctl',['--user','stop','factory_browser_'+row.browser_id.replaceAll('-','')+'.scope'],{timeout:25000}).catch(()=>{});
  const preview=(await this.controller.pool.query('SELECT id FROM factory.environments WHERE id=$1 OR allocation_key=$2',[row.qa_environment_id,`visual-${row.id}-${row.attempt_id}`])).rows[0];
  if(preview){
   await exec('systemctl',['--user','stop','factory_env_'+preview.id.replaceAll('-','')+'.slice'],{timeout:25000}).catch(()=>{});
   await this.controller.pool.query('UPDATE factory.environments SET retain_until=clock_timestamp() WHERE id=$1',[preview.id]);
  }
 }
 async recover(){
  for(const row of(await this.controller.pool.query("SELECT * FROM factory.visual_reviews WHERE storage_key=$1 AND status IN ('running','cancelling') AND lease_expires_at<clock_timestamp()",[this.key])).rows){
   await this.stop(row);await this.controller.pool.query(`UPDATE factory.visual_reviews SET status=CASE WHEN status='cancelling' THEN 'cancelled' ELSE 'needs_review' END,reason='visual_worker_interrupted',usage=jsonb_build_object('confirmed',false),finished_at=clock_timestamp() WHERE id=$1 AND attempt_id=$2 AND lease_expires_at<clock_timestamp()`,[row.id,row.attempt_id]);
  }
  for(const row of(await this.controller.pool.query("SELECT id FROM factory.visual_reviews WHERE storage_key=$1 AND status='queued' AND created_at<clock_timestamp()-interval '15 seconds'",[this.key])).rows)await this.controller.boss.send(this.queue,{id:row.id});
 }
 private async perform(id:string){const attempt=randomUUID(),row=(await this.controller.pool.query(`UPDATE factory.visual_reviews SET status='running',attempt_id=$2,lease_expires_at=clock_timestamp()+interval '30 seconds',deadline_at=clock_timestamp()+((input->>'maxRuntimeMs')::integer*interval '1 millisecond') WHERE id=$1 AND storage_key=$3 AND status='queued' RETURNING *`,[id,attempt,this.key])).rows[0];if(!row)return;
  const abort=new AbortController();this.active.set(id,abort);const deadline=setTimeout(()=>abort.abort('visual_review_timeout'),Math.max(1,row.deadline_at.getTime()-Date.now()));
  const heartbeat=setInterval(()=>{void this.controller.pool.query(`UPDATE factory.visual_reviews SET lease_expires_at=clock_timestamp()+interval '30 seconds' WHERE id=$1 AND attempt_id=$2 AND status IN ('running','cancelling') AND lease_expires_at>clock_timestamp() RETURNING status`,[id,attempt]).then(r=>{if(!r.rowCount)abort.abort('lease_lost');else if(r.rows[0].status==='cancelling')abort.abort('user_cancelled');}).catch(()=>abort.abort('lease_lost'));},5000);
  const artifacts=new AgentArtifacts(this.directory(id,attempt),268435456,row.candidate_revision),usage:ProviderUsage={inputTokens:0,cachedInputTokens:0,outputTokens:0,totalTokens:0,costMicros:null,confirmed:true};
  let report:unknown,status='needs_review',reason:string|null=null;
  try{
   if(sha256(canonicalJson(row.input))!==row.input_sha256)throw new Error('visual_input_changed');
   if(row.provider!==this.processor.provider||row.model!==this.controller.config.codexModel)throw new Error('visual_provider_changed');
   report=await this.processor.run(row,artifacts,abort.signal,usage,async(type,data)=>{
    abort.signal.throwIfAborted();await transaction(this.controller.pool,async client=>{
     const valid=await client.query("SELECT id FROM factory.visual_reviews WHERE id=$1 AND attempt_id=$2 AND status='running' AND lease_expires_at>clock_timestamp() AND deadline_at>clock_timestamp() FOR UPDATE",[id,attempt]);if(!valid.rowCount)throw new Error('visual_authority_revoked');
     if(type==='task_started')await client.query('UPDATE factory.visual_reviews SET active_task_id=$2 WHERE id=$1',[id,data.taskId]);
     if(type==='task_finished')await client.query('UPDATE factory.visual_reviews SET active_task_id=NULL,usage=$2 WHERE id=$1',[id,usage]);
     if(type==='browser_started')await client.query('UPDATE factory.visual_reviews SET browser_id=$2 WHERE id=$1',[id,data.browserId]);
     if(type==='qa_environment_allocated')await client.query('UPDATE factory.visual_reviews SET qa_environment_id=$2 WHERE id=$1',[id,data.environmentId]);
     await client.query('INSERT INTO factory.visual_review_events(review_id,type,data) VALUES($1,$2,$3)',[id,type,data]);
    });
   });
   abort.signal.throwIfAborted();if(!usage.confirmed||usage.totalTokens>row.input.maxObservedTokens)throw new Error('visual_review_budget_exceeded');
   const result=z.object({candidateRevision:z.literal(row.candidate_revision),sourceDigest:z.literal(row.source_digest),releaseEligible:z.literal(false)}).passthrough().safeParse(report);
   if(!result.success)throw new Error('visual_review_result_invalid');status='reviewed';
  }catch(error){reason=typeof abort.signal.reason==='string'?abort.signal.reason:error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:'visual_review_failed';report=undefined;}
  finally{clearTimeout(deadline);clearInterval(heartbeat);this.active.delete(id);}
  await transaction(this.controller.pool,async client=>{
   const current=(await client.query("SELECT * FROM factory.visual_reviews WHERE id=$1 AND attempt_id=$2 AND status IN ('running','cancelling') AND lease_expires_at>clock_timestamp() FOR UPDATE",[id,attempt])).rows[0];if(!current)return;
   if(current.status==='cancelling'){status='cancelled';reason='user_cancelled';report=undefined;}else if(current.deadline_at.getTime()<Date.now()){status='needs_review';reason='visual_review_timeout';report=undefined;}
   await client.query('UPDATE factory.visual_reviews SET status=$2,reason=$3,report=$4,artifacts=$5,usage=$6,active_task_id=NULL,finished_at=clock_timestamp() WHERE id=$1',[id,status,reason,report??null,JSON.stringify(artifacts.records.map(({filename,...item})=>item)),usage]);
  });
 }
}
