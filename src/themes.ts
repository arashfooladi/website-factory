import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import type {IncomingMessage} from 'node:http';
import type {PoolClient} from 'pg';
import {Controller,ControllerError} from './controller.js';
import {transaction} from './database.js';
import type {Environments} from './environments.js';
import {canonicalJson,sha256} from './immutable.js';
import {AgentArtifacts} from './agent-artifacts.js';
import {certifyThemeRuntime} from './theme-certification.js';

const exec=promisify(execFile),QUEUE='factory-theme-certification-v1';
export const BASELINE_BUNDLE_ID='42b95616-7350-48de-9489-181df7c401bb';
const baselineReady=new WeakMap<Controller,Promise<void>>();
export interface ThemeManifest {id:string;family:string;parentSlug:string;sourceDigest:string;versions:{parent:string;child:string;plugin:string};files:Record<string,string>;origin:Record<string,unknown>}
async function command(controller:Controller,action:string,id:string,args:string[]=[]):Promise<ThemeManifest>{
  const result=await exec('python3',[resolve('tools/theme_bundles.py'),action,id,'--root',controller.config.themeRoot,...args],{timeout:60000,maxBuffer:2097152});
  return JSON.parse(result.stdout);
}
export async function runtimeLockHash(){return sha256(await readFile(resolve('fixtures/runtime.lock.json')));}
export async function ensureThemeBaseline(controller:Controller){
  let ready=baselineReady.get(controller);
  if(!ready){
    ready=(async()=>{
      const certificate=JSON.parse(await readFile(resolve('fixtures/theme-baseline-certification.json'),'utf8'));
      if(sha256(await readFile(resolve('baseline/manifest.json')))!==certificate.baselineManifestSha256||await runtimeLockHash()!==certificate.runtimeLockSha256)
        throw new Error('baseline_certification_changed');
      const manifest=await command(controller,'baseline',BASELINE_BUNDLE_ID);
      await transaction(controller.pool,async client=>{
        await client.query(`INSERT INTO factory.theme_bundles(id,manifest,source_digest,status,runtime_sha256,report)
          VALUES($1,$2,$3,'certified',$4,$5) ON CONFLICT(id) DO NOTHING`,[BASELINE_BUNDLE_ID,manifest,manifest.sourceDigest,certificate.runtimeLockSha256,certificate]);
        const existing=(await client.query('SELECT source_digest FROM factory.theme_bundles WHERE id=$1',[BASELINE_BUNDLE_ID])).rows[0];
        if(existing.source_digest!==manifest.sourceDigest)throw new Error('baseline_bundle_revision_conflict');
        await client.query('INSERT INTO factory.theme_settings(singleton,default_bundle_id) VALUES(true,$1) ON CONFLICT(singleton) DO NOTHING',[BASELINE_BUNDLE_ID]);
        // Legacy records predate selectable bundles. Pin them to the baseline they actually used.
        for(const table of ['environments','intakes','build_runs'])await client.query(`UPDATE factory.${table} SET theme_bundle_id=$1 WHERE theme_bundle_id IS NULL`,[BASELINE_BUNDLE_ID]);
        await client.query(`UPDATE factory.projects p SET theme_bundle_id=(SELECT pin FROM (
          SELECT theme_bundle_id AS pin,created_at FROM factory.intakes WHERE project_id=p.id
          UNION ALL SELECT theme_bundle_id AS pin,created_at FROM factory.environments WHERE project_id=p.id
        ) history WHERE pin IS NOT NULL ORDER BY created_at LIMIT 1) WHERE p.site_type='wordpress' AND p.theme_bundle_id IS NULL`);
      });
    })();
    baselineReady.set(controller,ready);ready.catch(()=>baselineReady.delete(controller));
  }
  return ready;
}
export async function selectTheme(controller:Controller,client:PoolClient,id?:string,certifying=false){
  const row=(await client.query(`SELECT t.* FROM factory.theme_bundles t WHERE t.id=COALESCE($1::uuid,
    (SELECT default_bundle_id FROM factory.theme_settings WHERE singleton))`,[id??null])).rows[0];
  if(!row)throw new ControllerError('theme_bundle_not_found',404);
  if(certifying?row.status!=='certifying':row.status!=='certified'||row.runtime_sha256!==await runtimeLockHash())throw new ControllerError('theme_bundle_not_certified');
  return row as {id:string;source_digest:string;manifest:ThemeManifest;status:string;runtime_sha256:string};
}
export async function selectProjectTheme(controller:Controller,client:PoolClient,projectId:string,id?:string,certifying=false){
  const project=(await client.query('SELECT theme_bundle_id FROM factory.projects WHERE id=$1 FOR UPDATE',[projectId])).rows[0];if(!project)throw new ControllerError('not_found',404);
  const theme=await selectTheme(controller,client,id??project.theme_bundle_id??undefined,certifying);
  if(!project.theme_bundle_id)await client.query('UPDATE factory.projects SET theme_bundle_id=$2 WHERE id=$1',[projectId,theme.id]);
  return theme;
}
export class Themes {
  private registration?:string;
  private timer?:ReturnType<typeof setInterval>;
  private active=new Map<string,AbortController>();
  private checking:Promise<unknown>|null=null;
  constructor(readonly controller:Controller,readonly environments?:Environments){}
  private authorized(owner:string){if(owner!==this.controller.config.ownerId)throw new ControllerError('not_found',404);}
  async open(){
    await ensureThemeBaseline(this.controller);
    if(!this.environments)return this;
    const options={retryLimit:0,expireInSeconds:1800,retentionSeconds:86400};
    await this.controller.boss.createQueue(QUEUE,options);await this.controller.boss.updateQueue(QUEUE,options);await this.recover();
    this.registration=await this.controller.boss.work<{bundleId:string}>(QUEUE,{pollingIntervalSeconds:0.5,localConcurrency:1},async jobs=>{
      for(const job of jobs)await this.perform(job.data.bundleId);
    });
    this.timer=setInterval(()=>{if(!this.checking)this.checking=this.recover().catch(()=>console.error(JSON.stringify({event:'theme_recovery_failed'}))).finally(()=>this.checking=null);},5000);
    return this;
  }
  async close(){
    clearInterval(this.timer);for(const abort of this.active.values())abort.abort('controller_shutdown');
    if(this.checking)await this.checking;
    if(this.registration)await this.controller.boss.offWork(QUEUE,{id:this.registration,wait:true});
  }
  async list(owner:string){
    this.authorized(owner);await ensureThemeBaseline(this.controller);
    return{defaultBundleId:(await this.controller.pool.query('SELECT default_bundle_id FROM factory.theme_settings WHERE singleton')).rows[0].default_bundle_id,
      bundles:(await this.controller.pool.query(`SELECT id,status,source_digest,manifest->'versions' AS versions,manifest->'origin' AS origin,
        runtime_sha256,reason,created_at FROM factory.theme_bundles ORDER BY created_at`)).rows};
  }
  async inspect(owner:string,id:string){
    this.authorized(owner);await ensureThemeBaseline(this.controller);
    const row=(await this.controller.pool.query('SELECT * FROM factory.theme_bundles WHERE id=$1',[id])).rows[0];
    if(!row)throw new ControllerError('not_found',404);
    return{...row,events:(await this.controller.pool.query('SELECT type,data,at FROM factory.theme_events WHERE bundle_id=$1 ORDER BY id',[id])).rows};
  }
  async verified(id:string){
    const row=(await this.controller.pool.query('SELECT manifest FROM factory.theme_bundles WHERE id=$1',[id])).rows[0];
    if(!row)throw new ControllerError('theme_bundle_not_found',404);
    const actual=await command(this.controller,'verify',id);
    if(canonicalJson(actual)!==canonicalJson(row.manifest))throw new ControllerError('theme_bundle_integrity_failed');
    return actual;
  }
  async importParent(owner:string,request:IncomingMessage){
    this.authorized(owner);await ensureThemeBaseline(this.controller);
    if(!['application/zip','application/octet-stream'].includes(String(request.headers['content-type']??'').split(';')[0]!))throw new ControllerError('zip_required',415);
    const baseId=String(request.headers['x-factory-base-bundle']??(await this.list(owner)).defaultBundleId);
    if(!/^[a-f0-9-]{36}$/.test(baseId))throw new ControllerError('invalid_base_bundle',400);
    await this.inspect(owner,baseId);await this.verified(baseId);
    if(Number((await this.controller.pool.query('SELECT count(*) AS count FROM factory.theme_bundles')).rows[0].count)>=40)throw new ControllerError('theme_bundle_capacity_reached');
    const chunks:Buffer[]=[];let size=0;
    for await(const chunk of request.iterator({destroyOnReturn:false})){size+=chunk.length;if(size>67108864)throw new ControllerError('theme_archive_too_large',413);chunks.push(Buffer.from(chunk));}
    if(!size)throw new ControllerError('theme_archive_empty',400);
    return this.importFile(owner,Buffer.concat(chunks),baseId);
  }
  async importFile(owner:string,bytes:Buffer,baseId:string){
    this.authorized(owner);await ensureThemeBaseline(this.controller);await this.inspect(owner,baseId);await this.verified(baseId);
    if(!bytes.length||bytes.length>67108864)throw new ControllerError('theme_archive_size_invalid',400);
    const id=randomUUID(),directory=join(this.controller.config.themeRoot,'imports');await mkdir(directory,{recursive:true,mode:0o700});
    const file=join(directory,id+'.zip');await writeFile(file,bytes,{mode:0o600,flag:'wx'});
    try{
      let manifest:ThemeManifest;
      try{manifest=await command(this.controller,'import-parent',id,['--file',file,'--base',baseId]);}catch{throw new ControllerError('theme_archive_invalid',400);}
      await this.controller.pool.query("INSERT INTO factory.theme_bundles(id,manifest,source_digest,status) VALUES($1,$2,$3,'imported')",[id,manifest,manifest.sourceDigest]);
      await this.controller.pool.query("INSERT INTO factory.theme_events(bundle_id,type,data) VALUES($1,'imported',$2)",[id,{baseBundleId:baseId,sourceDigest:manifest.sourceDigest}]);
      return{id,status:'imported',versions:manifest.versions,sourceDigest:manifest.sourceDigest};
    }finally{await unlink(file).catch(()=>{});}
  }
  async setDefault(owner:string,id:string){
    this.authorized(owner);await ensureThemeBaseline(this.controller);await this.verified(id);
    return transaction(this.controller.pool,async client=>{
      await selectTheme(this.controller,client,id);
      await client.query('UPDATE factory.theme_settings SET default_bundle_id=$1 WHERE singleton',[id]);
      await client.query("INSERT INTO factory.theme_events(bundle_id,type,data) VALUES($1,'selected_default',$2)",[id,{policy:'Only new unpinned jobs use this default. Existing briefs, designs, environments and sites keep their recorded bundle.'}]);
      return{defaultBundleId:id};
    });
  }
  async setProjectDefault(owner:string,projectId:string,id:string){
    await ensureThemeBaseline(this.controller);await this.verified(id);
    return transaction(this.controller.pool,async client=>{
      const project=(await client.query("SELECT * FROM factory.projects WHERE id=$1 AND owner_id=$2 AND site_type='wordpress' FOR UPDATE",[projectId,owner])).rows[0];
      if(!project)throw new ControllerError('not_found',404);await selectTheme(this.controller,client,id);
      await client.query('UPDATE factory.projects SET theme_bundle_id=$2 WHERE id=$1',[projectId,id]);
      await client.query("INSERT INTO factory.theme_events(bundle_id,type,data) VALUES($1,'selected_project_default',$2)",[id,{projectId,policy:'Future unpinned briefs/environments only. Existing records and sites retain their version.'}]);
      return{projectId,themeBundleId:id};
    });
  }
  async certify(owner:string,id:string){
    this.authorized(owner);await this.inspect(owner,id);await this.verified(id);
    return transaction(this.controller.pool,async client=>{
      const row=(await client.query('SELECT * FROM factory.theme_bundles WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(row.status==='certified')return{id,status:row.status};
      if(['queued','certifying'].includes(row.status))return{id,status:row.status};
      const projectId=row.validation_project_id??randomUUID();
      if(!row.validation_project_id)await client.query("INSERT INTO factory.projects(id,owner_id,name,site_type) VALUES($1,$2,$3,'wordpress')",[projectId,owner,'MainTheme compatibility '+row.manifest.versions.parent]);
      await client.query("UPDATE factory.theme_bundles SET status='queued',validation_project_id=$2,environment_id=NULL,reason=NULL,updated_at=clock_timestamp() WHERE id=$1",[id,projectId]);
      await this.controller.boss.send(QUEUE,{bundleId:id},{db:{executeSql:(text,values)=>client.query(text,values)}});
      return{id,status:'queued'};
    });
  }
  async artifact(owner:string,id:string,artifactId:string){
    const row=await this.inspect(owner,id),metadata=row.report?.artifacts?.find((item:any)=>item.id===artifactId);
    if(!metadata||!row.attempt_id)throw new ControllerError('not_found',404);
    const bytes=await readFile(join(this.controller.config.themeRoot,'certifications',id,row.attempt_id,'artifacts',artifactId));
    if(sha256(bytes)!==metadata.sha256)throw new ControllerError('artifact_hash_mismatch');return{bytes,metadata};
  }
  async recover(){
    const lost=(await this.controller.pool.query("SELECT * FROM factory.theme_bundles WHERE status='certifying' AND lease_expires_at<clock_timestamp()")).rows;
    for(const row of lost){
      if(row.browser_id)await exec('systemctl',['--user','stop','factory_browser_'+row.browser_id.replaceAll('-','')+'.scope'],{timeout:25000}).catch(()=>{});
      await this.controller.pool.query("UPDATE factory.theme_bundles SET status='needs_review',reason='certification_worker_interrupted',updated_at=clock_timestamp() WHERE id=$1 AND attempt_id=$2 AND lease_expires_at<clock_timestamp()",[row.id,row.attempt_id]);
      await this.cleanup(row.environment_id);
    }
    const queued=(await this.controller.pool.query("SELECT id FROM factory.theme_bundles WHERE status='queued' AND updated_at<clock_timestamp()-interval '15 seconds'")).rows;
    for(const row of queued)await this.controller.boss.send(QUEUE,{bundleId:row.id});
  }
  private async cleanup(id?:string){
    if(!id||!this.environments)return;
    const state=await this.environments.inspect(this.controller.config.ownerId,id).catch(()=>null);
    if(state&&state.status!=='deleted'&&!state.current_operation_id)await this.environments.request(this.controller.config.ownerId,id,'destroy').catch(()=>{});
  }
  private async waitEnvironment(id:string,status:string,signal:AbortSignal){
    for(;;){
      signal.throwIfAborted();const state=await this.environments!.inspect(this.controller.config.ownerId,id);
      if(['failed','deleted'].includes(state.status))throw new Error('theme_environment_failed');
      if(state.status===status&&!state.current_operation_id)return state;
      await new Promise(done=>setTimeout(done,300));
    }
  }
  private async perform(id:string){
    const attempt=randomUUID(),row=(await this.controller.pool.query(`UPDATE factory.theme_bundles SET status='certifying',attempt_id=$2,
      lease_expires_at=clock_timestamp()+interval '30 seconds',deadline_at=clock_timestamp()+interval '20 minutes',browser_id=NULL
      WHERE id=$1 AND status='queued' RETURNING *`,[id,attempt])).rows[0];if(!row)return;
    const abort=new AbortController();this.active.set(id,abort);
    const timeout=setTimeout(()=>abort.abort('theme_certification_timeout'),Math.max(1,row.deadline_at.getTime()-Date.now()));
    const heartbeat=setInterval(()=>{void this.controller.pool.query(`UPDATE factory.theme_bundles SET lease_expires_at=clock_timestamp()+interval '30 seconds'
      WHERE id=$1 AND attempt_id=$2 AND status='certifying' AND lease_expires_at>clock_timestamp() RETURNING id`,[id,attempt]).then(result=>{if(!result.rowCount)abort.abort('lease_lost');}).catch(()=>abort.abort('lease_lost'));},5000);
    const artifacts=new AgentArtifacts(join(this.controller.config.themeRoot,'certifications',id,attempt,'artifacts'),67108864);
    const report:any={version:1,bundleId:id,sourceDigest:row.source_digest,checks:[],artifacts:[]};
    let status='needs_review',reason:string|null=null,environmentId:string|undefined,runtimeHash:string|undefined;
    try{
      const manifest=await this.verified(id);runtimeHash=await runtimeLockHash();report.runtimeLockSha256=runtimeHash;
      const staticResult=await exec('python3',[resolve('tools/validate_maintheme_v4.py'),'--root',join(this.controller.config.themeRoot,'bundles',id,'source'),
        '--php',resolve('tools/php'),'--parent-version',manifest.versions.parent,'--child-version',manifest.versions.child,'--plugin-version',manifest.versions.plugin],
        {timeout:120000,maxBuffer:1048576,signal:abort.signal}).catch(async(error:any)=>{await artifacts.save('theme_static_checks','text/plain',String(error.stdout??'')+String(error.stderr??''));throw new Error('theme_static_checks_failed');});
      await artifacts.save('theme_static_checks','text/plain',staticResult.stdout);report.checks.push({key:'static-contract',status:'passed'});
      abort.signal.throwIfAborted();
      const allocated=await this.environments!.create(this.controller.config.ownerId,{projectId:row.validation_project_id,themeBundleId:id,limits:{ttlSeconds:3600,retentionSeconds:3600}},
        {themeCertificationId:id,allocationKey:`theme:${id}:${attempt}`});const validationId=String(allocated.id);environmentId=validationId;
      await this.controller.pool.query('UPDATE factory.theme_bundles SET environment_id=$3 WHERE id=$1 AND attempt_id=$2',[id,attempt,validationId]);
      await this.waitEnvironment(validationId,'stopped',abort.signal);await this.environments!.request(this.controller.config.ownerId,validationId,'start');
      await this.waitEnvironment(validationId,'running',abort.signal);
      await certifyThemeRuntime(this.environments!,validationId,manifest,artifacts,abort.signal,report,async browserId=>{
        const valid=await this.controller.pool.query(`UPDATE factory.theme_bundles SET browser_id=$3 WHERE id=$1 AND attempt_id=$2 AND status='certifying'
          AND lease_expires_at>clock_timestamp() RETURNING id`,[id,attempt,browserId]);if(!valid.rowCount)throw new Error('theme_certification_authority_revoked');
      });
      await this.verified(id);if(await runtimeLockHash()!==runtimeHash)throw new Error('theme_runtime_lock_changed');
      abort.signal.throwIfAborted();status='certified';
    }catch(error){reason=typeof abort.signal.reason==='string'?abort.signal.reason:error instanceof Error&&/^[a-z_]{3,100}$/.test(error.message)?error.message:'theme_certification_failed';}
    finally{clearInterval(heartbeat);clearTimeout(timeout);this.active.delete(id);await this.cleanup(environmentId);}
    report.artifacts=artifacts.records;report.scope='Parent/child/plugin runtime compatibility only. Client design, independent QA and release gates are separate.';
    await transaction(this.controller.pool,async client=>{
      const valid=await client.query(`SELECT id FROM factory.theme_bundles WHERE id=$1 AND attempt_id=$2 AND status='certifying'
        AND lease_expires_at>clock_timestamp() FOR UPDATE`,[id,attempt]);if(!valid.rowCount)return;
      if(row.deadline_at.getTime()<Date.now()){status='needs_review';reason='theme_certification_timeout';}
      await client.query('UPDATE factory.theme_bundles SET status=$2,reason=$3,report=$4,runtime_sha256=$5,updated_at=clock_timestamp() WHERE id=$1',[id,status,reason,report,status==='certified'?runtimeHash:null]);
      await client.query("INSERT INTO factory.theme_events(bundle_id,type,data) VALUES($1,'certification_finished',$2)",[id,{status,reason}]);
    });
  }
}
