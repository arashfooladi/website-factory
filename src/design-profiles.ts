import {randomUUID} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Controller,ControllerError} from './controller.js';
import {transaction} from './database.js';
import {AgentArtifacts} from './agent-artifacts.js';
import {CodexAdapter} from './codex-adapter.js';
import type {ProviderAdapter,ProviderUsage} from './agent-contracts.js';
import {CalibrationInput,runDesignCalibration} from './design-calibration.js';
import {sha256} from './immutable.js';

const exec=promisify(execFile),QUEUE='factory-design-calibration-v1';
export interface AssignedDesignProfile {id:string;sha256:string;instructions:string;metadata:{provider:string;model:string;domain:string;sampleCount:number;provisional:boolean;caveats:string[]}}
export class DesignProfiles {
  private active=new Map<string,AbortController>();private registration?:string;private timer?:ReturnType<typeof setInterval>;private checking:Promise<unknown>|null=null;
  constructor(readonly controller:Controller,readonly adapter:ProviderAdapter=new CodexAdapter(controller.config)){}
  private storageKey(){return sha256(this.controller.config.designRoot);}
  private directory(id:string){return join(this.controller.config.designRoot,'profiles',id);}
  async open(){
    await mkdir(this.controller.config.designRoot,{recursive:true,mode:0o700});
    const options={retryLimit:0,expireInSeconds:3660,retentionSeconds:86400};await this.controller.boss.createQueue(QUEUE,options);await this.controller.boss.updateQueue(QUEUE,options);await this.recover();
    this.registration=await this.controller.boss.work<{profileId:string}>(QUEUE,{pollingIntervalSeconds:0.5,localConcurrency:1},async jobs=>{for(const job of jobs)await this.perform(job.data.profileId);});
    this.timer=setInterval(()=>{if(!this.checking)this.checking=this.recover().catch(()=>console.error(JSON.stringify({event:'design_profile_recovery_failed'}))).finally(()=>this.checking=null);},5000);return this;
  }
  async close(){clearInterval(this.timer);for(const abort of this.active.values())abort.abort('controller_shutdown');if(this.checking)await this.checking;
    if(this.registration)await this.controller.boss.offWork(QUEUE,{id:this.registration,wait:true});}
  async create(owner:string,raw:unknown){
    const input=CalibrationInput.parse(raw);
    return transaction(this.controller.pool,async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('factory-design-calibration',0))");
      if((await client.query("SELECT 1 FROM factory.design_profiles WHERE status IN ('queued','running','cancelling')")).rowCount)throw new ControllerError('design_calibration_active');
      const id=randomUUID();await client.query("INSERT INTO factory.design_profiles(id,owner_id,provider,model,domain,status,input,storage_key) VALUES($1,$2,$3,$4,$5,'queued',$6,$7)",[id,owner,this.adapter.name,this.controller.config.codexModel,input.domain,input,this.storageKey()]);
      await this.controller.boss.send(QUEUE,{profileId:id},{db:{executeSql:(text,values)=>client.query(text,values)}});return{id,status:'queued'};
    });
  }
  async list(owner:string){return(await this.controller.pool.query('SELECT id,provider,model,domain,status,profile->\'sampleCount\' AS sample_count,profile->\'eligible\' AS eligible,reason,created_at FROM factory.design_profiles WHERE owner_id=$1 ORDER BY created_at DESC',[owner])).rows;}
  async inspect(owner:string,id:string){
    const row=(await this.controller.pool.query('SELECT * FROM factory.design_profiles WHERE id=$1 AND owner_id=$2',[id,owner])).rows[0];if(!row)throw new ControllerError('not_found',404);
    return{...row,events:(await this.controller.pool.query('SELECT type,data,at FROM factory.design_profile_events WHERE profile_id=$1 ORDER BY id',[id])).rows};
  }
  async artifact(owner:string,id:string,artifactId:string){
    const row=await this.inspect(owner,id),metadata=row.artifacts.find((item:any)=>item.id===artifactId);if(!metadata||!row.attempt_id)throw new ControllerError('not_found',404);
    const bytes=await readFile(join(this.directory(id),row.attempt_id,'artifacts',artifactId));if(sha256(bytes)!==metadata.sha256)throw new ControllerError('artifact_hash_mismatch');return{bytes,metadata};
  }
  async assigned(owner:string,id:string):Promise<AssignedDesignProfile>{
    const row=await this.inspect(owner,id);
    if(row.storage_key&&row.storage_key!==this.storageKey())throw new ControllerError('unslop_profile_storage_mismatch');
    if(row.status!=='completed'||!row.profile?.eligible)throw new ControllerError('unslop_profile_not_eligible');
    if(row.provider!==this.adapter.name||row.model!==this.controller.config.codexModel)throw new ControllerError('unslop_profile_model_mismatch');
    const skill=await this.artifact(owner,id,row.profile.skillArtifactId);if(skill.metadata.sha256!==row.profile.skillSha256)throw new ControllerError('artifact_hash_mismatch');
    return{id,sha256:skill.metadata.sha256,instructions:skill.bytes.toString('utf8'),metadata:{provider:row.provider,model:row.model,domain:row.domain,
      sampleCount:row.profile.sampleCount,provisional:row.profile.provisional,caveats:row.profile.caveats}};
  }
  async select(owner:string,preferences?:{skillPacks?:string[];unslopProfileId?:string;domain?:string}):Promise<AssignedDesignProfile|null>{
    if(!(preferences?.skillPacks??[]).includes('unslop-calibration'))return null;
    if(preferences?.unslopProfileId)return this.assigned(owner,preferences.unslopProfileId);
    const row=(await this.controller.pool.query(`SELECT id FROM factory.design_profiles WHERE owner_id=$1 AND provider=$2 AND model=$3 AND domain=$4
      AND status='completed' AND profile->>'eligible'='true' AND storage_key=$5 ORDER BY created_at DESC LIMIT 1`,[owner,this.adapter.name,this.controller.config.codexModel,preferences?.domain??'WordPress small-business commerce',this.storageKey()])).rows[0];
    return row?this.assigned(owner,row.id):null;
  }
  async cancel(owner:string,id:string){await this.inspect(owner,id);const result=await this.controller.pool.query(`UPDATE factory.design_profiles SET
    status=CASE WHEN status='queued' THEN 'cancelled' ELSE 'cancelling' END,reason='user_cancelled' WHERE id=$1 AND status IN ('queued','running','cancelling') RETURNING status`,[id]);
    this.active.get(id)?.abort('user_cancelled');return{id,status:result.rows[0]?.status??(await this.inspect(owner,id)).status};}
  private async stop(row:any){
    if(row.active_task_id)await exec('python3',[resolve('tools/agent_sandbox.py'),'stop',row.active_task_id],{env:{...process.env,FACTORY_AGENT_ROOT:this.controller.config.agentRoot},timeout:25000}).catch(()=>{});
    if(row.browser_id)await exec('systemctl',['--user','stop','factory_browser_'+row.browser_id.replaceAll('-','')+'.scope'],{timeout:25000}).catch(()=>{});
  }
  async recover(){
    for(const row of(await this.controller.pool.query("SELECT * FROM factory.design_profiles WHERE status IN ('running','cancelling') AND lease_expires_at<clock_timestamp()")).rows){
      await this.stop(row);await this.controller.pool.query(`UPDATE factory.design_profiles SET status=CASE WHEN status='cancelling' THEN 'cancelled' ELSE 'needs_review' END,
        reason='calibration_worker_interrupted',usage=jsonb_build_object('confirmed',false,'reservedTokens',(input->>'maxObservedTokens')::integer),finished_at=clock_timestamp()
        WHERE id=$1 AND attempt_id=$2 AND lease_expires_at<clock_timestamp()`,[row.id,row.attempt_id]);
    }
    for(const row of(await this.controller.pool.query("SELECT id FROM factory.design_profiles WHERE status='queued' AND created_at<clock_timestamp()-interval '15 seconds'")).rows)await this.controller.boss.send(QUEUE,{profileId:row.id});
  }
  private async perform(id:string){
    const attempt=randomUUID(),row=(await this.controller.pool.query(`UPDATE factory.design_profiles SET status='running',attempt_id=$2,
      lease_expires_at=clock_timestamp()+interval '30 seconds',deadline_at=clock_timestamp()+((input->>'maxRuntimeMs')::integer*interval '1 millisecond')
      WHERE id=$1 AND status='queued' RETURNING *`,[id,attempt])).rows[0];if(!row)return;
    const abort=new AbortController();this.active.set(id,abort);const timeout=setTimeout(()=>abort.abort('calibration_timeout'),Math.max(1,row.deadline_at.getTime()-Date.now()));
    const heartbeat=setInterval(()=>{void this.controller.pool.query(`UPDATE factory.design_profiles SET lease_expires_at=clock_timestamp()+interval '30 seconds'
      WHERE id=$1 AND attempt_id=$2 AND status IN ('running','cancelling') AND lease_expires_at>clock_timestamp() RETURNING status`,[id,attempt]).then(result=>{
        if(!result.rowCount)abort.abort('lease_lost');else if(result.rows[0].status==='cancelling')abort.abort('user_cancelled');}).catch(()=>abort.abort('lease_lost'));},5000);
    const artifacts=new AgentArtifacts(join(this.directory(id),attempt,'artifacts'),134217728),usage:ProviderUsage={inputTokens:0,cachedInputTokens:0,outputTokens:0,totalTokens:0,costMicros:null,confirmed:true};
    let profile:any,status='needs_review',reason:string|null=null;
    try{
      if(row.provider!==this.adapter.name||row.model!==this.controller.config.codexModel)throw new Error('provider_configuration_changed');
      profile=await runDesignCalibration(row.input,row.model,this.adapter,artifacts,abort.signal,async(type,data)=>{
        await transaction(this.controller.pool,async client=>{
          const valid=await client.query(`SELECT id FROM factory.design_profiles WHERE id=$1 AND attempt_id=$2 AND status='running'
            AND lease_expires_at>clock_timestamp() AND deadline_at>clock_timestamp() FOR UPDATE`,[id,attempt]);if(!valid.rowCount)throw new Error('calibration_authority_revoked');
          if(type==='task_started')await client.query('UPDATE factory.design_profiles SET active_task_id=$2 WHERE id=$1',[id,data.taskId]);
          if(type==='task_finished')await client.query('UPDATE factory.design_profiles SET active_task_id=NULL,usage=$2 WHERE id=$1',[id,usage]);
          if(type==='browser_started')await client.query('UPDATE factory.design_profiles SET browser_id=$2 WHERE id=$1',[id,data.browserId]);
          await client.query('INSERT INTO factory.design_profile_events(profile_id,type,data) VALUES($1,$2,$3)',[id,type,data]);
        });
      },usage);status=profile.eligible?'completed':'needs_review';reason=profile.eligible?null:'calibration_comparison_inconclusive';
    }catch(error){reason=typeof abort.signal.reason==='string'?abort.signal.reason:error instanceof Error&&/^[a-z_]{3,100}$/.test(error.message)?error.message:'design_calibration_failed';}
    finally{clearTimeout(timeout);clearInterval(heartbeat);this.active.delete(id);}
    await transaction(this.controller.pool,async client=>{
      const valid=(await client.query(`SELECT * FROM factory.design_profiles WHERE id=$1 AND attempt_id=$2 AND status IN ('running','cancelling')
        AND lease_expires_at>clock_timestamp() FOR UPDATE`,[id,attempt])).rows[0];if(!valid)return;
      if(valid.status==='cancelling'){status='cancelled';reason='user_cancelled';profile=undefined;}
      else if(valid.deadline_at.getTime()<Date.now()){status='needs_review';reason='calibration_timeout';profile=undefined;}
      await client.query(`UPDATE factory.design_profiles SET status=$2,reason=$3,profile=$4,artifacts=$5,usage=$6,active_task_id=NULL,finished_at=clock_timestamp() WHERE id=$1`,
        [id,status,reason,profile??null,JSON.stringify(artifacts.records.map(({filename,...artifact})=>artifact)),usage]);
    });
  }
}
