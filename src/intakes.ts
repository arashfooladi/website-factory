import {randomUUID} from 'node:crypto';
import {mkdir,readFile,link} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Controller,ControllerError} from './controller.js';
import {transaction} from './database.js';
import {IntakeInput,type IntakeBrief} from './intake-contracts.js';
import {canonicalJson,sha256} from './immutable.js';
import {AgentArtifacts} from './agent-artifacts.js';
import {PublicReferenceNetwork} from './reference-network.js';
import {captureReferences,createBuildSpecification} from './reference-capture.js';
import {ensureThemeBaseline,selectProjectTheme} from './themes.js';

const exec=promisify(execFile),QUEUE='factory-reference-v1';
const baselinePath=resolve('instructions/acceptance/wordpress-v1.json');
export class Intakes {
  private active=new Map<string,AbortController>();
  private registration?:string;
  private timer?:ReturnType<typeof setInterval>;
  private checking:Promise<unknown>|null=null;
  constructor(readonly controller:Controller,readonly networkFactory:(signal:AbortSignal)=>PublicReferenceNetwork=signal=>new PublicReferenceNetwork(signal)){}
  private directory(id:string){return join(this.controller.config.referenceRoot,'intakes',id);}
  async open(){
    await mkdir(this.controller.config.referenceRoot,{recursive:true,mode:0o700});
    const options={retryLimit:0,expireInSeconds:900,retentionSeconds:86400};
    await this.controller.boss.createQueue(QUEUE,options);await this.controller.boss.updateQueue(QUEUE,options);await this.recover();
    this.registration=await this.controller.boss.work<{intakeId:string}>(QUEUE,{pollingIntervalSeconds:0.5,localConcurrency:1},async jobs=>{
      for(const job of jobs)await this.perform(job.data.intakeId);
    });
    this.timer=setInterval(()=>{
      if(!this.checking)this.checking=this.recover().catch(()=>console.error(JSON.stringify({event:'reference_recovery_failed'}))).finally(()=>this.checking=null);
    },5000);return this;
  }
  async close(){
    clearInterval(this.timer);for(const abort of this.active.values())abort.abort('controller_shutdown');
    if(this.checking)await this.checking;
    if(this.registration)await this.controller.boss.offWork(QUEUE,{id:this.registration,wait:true});
  }
  private async owned(owner:string,id:string){
    const row=(await this.controller.pool.query(`SELECT i.* FROM factory.intakes i JOIN factory.projects p ON p.id=i.project_id WHERE i.id=$1 AND p.owner_id=$2`,[id,owner])).rows[0];
    if(!row)throw new ControllerError('not_found',404);return row;
  }
  async create(owner:string,raw:unknown){
    const brief=IntakeInput.parse(raw);
    await ensureThemeBaseline(this.controller);
    const project=(await this.controller.pool.query('SELECT site_type FROM factory.projects WHERE id=$1 AND owner_id=$2',[brief.projectId,owner])).rows[0];
    if(!project)throw new ControllerError('not_found',404);
    if(project.site_type!=='wordpress')throw new ControllerError('intake_profile_not_implemented');
    const network=this.networkFactory(new AbortController().signal);
    try{
      const urls=[...brief.referenceUrls,...brief.pages.flatMap(page=>page.referenceUrl?[page.referenceUrl]:[]),...brief.journeys.map(journey=>journey.referenceUrl)];
      const checks=await Promise.allSettled([...new Set(urls)].map(url=>network.validate(url)));
      if(checks.some(check=>check.status==='rejected'))throw new ControllerError('reference_address_denied',400);
    }finally{await network.close();}
    const baseline=await readFile(baselinePath);
    return transaction(this.controller.pool,async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('factory-intake-capacity',0))");
      const active=await client.query("SELECT project_id FROM factory.intakes WHERE status IN ('queued','running','cancelling')");
      if(active.rows.some(row=>row.project_id===brief.projectId))throw new ControllerError('intake_active');
      if((active.rowCount??0)>=2)throw new ControllerError('intake_capacity_reached');
      const assets=await client.query('SELECT id FROM factory.project_assets WHERE project_id=$1 AND id=ANY($2::uuid[])',[brief.projectId,brief.assetIds]);
      if(assets.rowCount!==new Set(brief.assetIds).size)throw new ControllerError('asset_not_found',404);
      const theme=await selectProjectTheme(this.controller,client,brief.projectId,brief.themeBundleId);brief.themeBundleId=theme.id;
      const revision=Number((await client.query('SELECT COALESCE(max(revision),0)+1 AS revision FROM factory.intakes WHERE project_id=$1',[brief.projectId])).rows[0].revision);
      const id=randomUUID();
      await client.query(`INSERT INTO factory.intakes(id,project_id,revision,status,brief,brief_sha256,baseline_sha256,theme_bundle_id) VALUES($1,$2,$3,'queued',$4,$5,$6,$7)`,
        [id,brief.projectId,revision,brief,sha256(canonicalJson(brief)),sha256(baseline),theme.id]);
      await this.controller.boss.send(QUEUE,{intakeId:id},{db:{executeSql:(text,values)=>client.query(text,values)}});
      return{id,revision,status:'queued',releaseEligible:false};
    });
  }
  async inspect(owner:string,id:string){
    const row=await this.owned(owner,id);
    const artifacts=(await this.controller.pool.query('SELECT id,kind,sha256,media_type,bytes FROM factory.intake_artifacts WHERE intake_id=$1 ORDER BY created_at',[id])).rows;
    const events=(await this.controller.pool.query('SELECT id,type,data,at FROM factory.intake_events WHERE intake_id=$1 ORDER BY id',[id])).rows;
    return{...row,artifacts,events,releaseEligible:false};
  }
  async revise(owner:string,id:string,patch:unknown){
    const row=await this.owned(owner,id);
    if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new ControllerError('invalid_brief_patch',400);
    const allowed=new Set(['themeBundleId','prompt','referenceUrls','mode','design','language','direction','businessName','pages','features','assetIds','journeys','budget','capture']);
    if(Object.keys(patch).some(key=>!allowed.has(key)))throw new ControllerError('invalid_brief_patch',400);
    const merge=(base:any,change:any):any=>{
      if(change===null||typeof change!=='object'||Array.isArray(change))return change;
      const result={...base};
      for(const [key,value]of Object.entries(change)){
        if(['__proto__','constructor','prototype'].includes(key))throw new ControllerError('invalid_brief_patch',400);
        if(value===null)delete result[key];else result[key]=merge(base?.[key],value);
      }
      return result;
    };
    return this.create(owner,{themeBundleId:row.theme_bundle_id,...merge(row.brief,patch),projectId:row.project_id});
  }
  async artifact(owner:string,id:string,artifactId:string){
    await this.owned(owner,id);
    const metadata=(await this.controller.pool.query('SELECT * FROM factory.intake_artifacts WHERE id=$1 AND intake_id=$2',[artifactId,id])).rows[0];
    if(!metadata)throw new ControllerError('not_found',404);
    const bytes=await readFile(join(this.directory(id),'artifacts',metadata.id));
    if(sha256(bytes)!==metadata.sha256)throw new ControllerError('artifact_hash_mismatch');return{metadata,bytes};
  }
  async cancel(owner:string,id:string){
    await this.owned(owner,id);
    const result=await this.controller.pool.query(`UPDATE factory.intakes SET status=CASE WHEN status='queued' THEN 'cancelled' ELSE 'cancelling' END,
      reason='user_cancelled',finished_at=CASE WHEN status='queued' THEN clock_timestamp() END WHERE id=$1 AND status IN ('queued','running','cancelling') RETURNING status`,[id]);
    this.active.get(id)?.abort('user_cancelled');return{id,status:result.rows[0]?.status??(await this.owned(owner,id)).status};
  }
  async recover(){
    const lost=(await this.controller.pool.query("SELECT * FROM factory.intakes WHERE status IN ('running','cancelling') AND lease_expires_at<clock_timestamp()")).rows;
    for(const row of lost){
      if(row.browser_id)await exec('systemctl',['--user','stop','factory_browser_'+row.browser_id.replaceAll('-','')+'.scope'],{timeout:25000}).catch(()=>{});
      await this.controller.pool.query(`UPDATE factory.intakes SET status=CASE WHEN status='cancelling' THEN 'cancelled' ELSE 'needs_review' END,
        reason='capture_worker_interrupted',finished_at=clock_timestamp() WHERE id=$1 AND attempt_id=$2 AND lease_expires_at<clock_timestamp()`,[row.id,row.attempt_id]);
    }
    const queued=(await this.controller.pool.query("SELECT id FROM factory.intakes WHERE status='queued' AND created_at<clock_timestamp()-interval '15 seconds'")).rows;
    for(const row of queued)await this.controller.boss.send(QUEUE,{intakeId:row.id});
  }
  private async valid(id:string,attempt:string){
    const result=await this.controller.pool.query(`SELECT 1 FROM factory.intakes WHERE id=$1 AND attempt_id=$2 AND status='running'
      AND lease_expires_at>clock_timestamp() AND deadline_at>clock_timestamp()`,[id,attempt]);
    if(!result.rowCount)throw new Error('reference_authority_revoked');
  }
  private async perform(id:string){
    const attempt=randomUUID();
    const row=(await this.controller.pool.query(`UPDATE factory.intakes SET status='running',attempt_id=$2,lease_expires_at=clock_timestamp()+interval '30 seconds',
      deadline_at=clock_timestamp()+((brief->'capture'->>'maxRuntimeMs')::integer*interval '1 millisecond') WHERE id=$1 AND status='queued' RETURNING *`,[id,attempt])).rows[0];
    if(!row)return;
    const abort=new AbortController();this.active.set(id,abort);
    const timeout=setTimeout(()=>abort.abort('capture_timeout'),Math.max(1,row.deadline_at.getTime()-Date.now()));
    let renewing=false;
    const heartbeat=setInterval(()=>{
      if(renewing)return;renewing=true;
      void this.controller.pool.query(`UPDATE factory.intakes SET lease_expires_at=clock_timestamp()+interval '30 seconds'
        WHERE id=$1 AND attempt_id=$2 AND status IN ('running','cancelling') AND lease_expires_at>clock_timestamp() RETURNING status`,[id,attempt])
        .then(result=>{if(!result.rowCount)abort.abort('lease_lost');else if(result.rows[0].status==='cancelling')abort.abort('user_cancelled');})
        .catch(()=>abort.abort('lease_lost')).finally(()=>renewing=false);
    },5000);
    const brief=row.brief as IntakeBrief,artifacts=new AgentArtifacts(join(this.directory(id),'artifacts'),brief.capture.maxArtifactBytes);
    let status='needs_review',reason:string|null=null,specId:string|null=null,acceptanceHash:string|null=null;
    let network:PublicReferenceNetwork|undefined;
    try{
      await this.valid(id,attempt);
      if(sha256(canonicalJson(brief))!==row.brief_sha256)throw new Error('brief_hash_mismatch');
      const baseline=await readFile(baselinePath);if(sha256(baseline)!==row.baseline_sha256)throw new Error('acceptance_baseline_changed');
      const assetManifest=(await this.controller.pool.query('SELECT id,name,media_type,bytes,sha256 FROM factory.project_assets WHERE project_id=$1 AND id=ANY($2::uuid[])',[row.project_id,brief.assetIds])).rows;
      const briefArtifact=await artifacts.save('brief','application/json',canonicalJson({version:1,revision:row.revision,brief,assets:assetManifest}));
      network=this.networkFactory(abort.signal);
      const resources:Array<{url:string;artifact:Awaited<ReturnType<AgentArtifacts['save']>>}>=[],seen=new Set<string>();
      network.onResource=async(url,result)=>{
        if(result.status!==200||!result.body.length)return;
        const mime=String(result.headers['content-type']??'application/octet-stream').split(';')[0]!;
        if(!/^(text\/|image\/|font\/|application\/(javascript|json))/.test(mime))return;
        const key=url+':'+sha256(result.body);if(seen.has(key))return;seen.add(key);
        const kind=mime==='text/css'?'source_stylesheet':mime==='text/html'?'source_document':/javascript/.test(mime)?'source_script':'source_asset';
        resources.push({url,artifact:await artifacts.save(kind,mime,result.body)});
      };
      const inventory=await captureReferences(brief,artifacts,abort.signal,network,async browserId=>{
        const authorized=await this.controller.pool.query(`UPDATE factory.intakes SET browser_id=$3 WHERE id=$1 AND attempt_id=$2 AND status='running'
          AND lease_expires_at>clock_timestamp() AND deadline_at>clock_timestamp() RETURNING id`,[id,attempt,browserId]);
        if(!authorized.rowCount)throw new Error('reference_authority_revoked');
      });
      await network.close();inventory.resources=resources;
      if(inventory.network.some(event=>['stylesheet','font'].includes(event.resourceType)&&(event.blocked||event.status>=400))){
        inventory.coverage.completeRequiredCaptures=false;
        inventory.failures.push({url:brief.referenceUrls[0]!,viewport:'all',step:'required-styling',reason:'reference_styling_incomplete'});
      }
      const inventoryArtifact=await artifacts.save('reference_inventory','application/json',canonicalJson(inventory));
      const flowMap=await artifacts.save('flow_map','application/json',canonicalJson({version:1,routes:inventory.routes,
        states:inventory.states.map(state=>({stateId:state.stateId,url:state.path,viewport:state.viewport,purpose:state.purpose})),
        observedTransitions:inventory.transitions,journeys:inventory.journeys,
        inferredLinks:inventory.links.map(item=>({...item,observedTransition:false})),
        notice:'Observed transitions record executed browser actions and resulting states. They do not assert functional success. Href links alone are inferred navigation possibilities.'}));
      const specification=createBuildSpecification(brief,inventory,JSON.parse(baseline.toString()),row.baseline_sha256,row.revision,assetManifest);
      const acceptance=await artifacts.save('acceptance','application/json',canonicalJson(specification.acceptance));acceptanceHash=acceptance.sha256;
      const spec=await artifacts.save('build_specification','application/json',canonicalJson({...specification,inputs:{brief:briefArtifact,referenceInventory:inventoryArtifact,flowMap,acceptance}}));specId=spec.id;
      await this.valid(id,attempt);
      const names=[[briefArtifact,'brief.json'],[inventoryArtifact,'reference-inventory.json'],[flowMap,'flow-map.json'],[acceptance,'acceptance.json'],[spec,'build-specification.json']]as const;
      const named=join(this.directory(id),'specification');await mkdir(named,{recursive:true,mode:0o700});
      for(const [artifact,name]of names)await link(join(this.directory(id),'artifacts',artifact.id),join(named,name));
      status=inventory.coverage.completeRequiredCaptures?'completed':'needs_review';reason=status==='completed'?null:'required_reference_capture_incomplete';
    }catch(error){reason=typeof abort.signal.reason==='string'?abort.signal.reason:error instanceof Error&&/^[a-z_]{3,100}$/.test(error.message)?error.message:'reference_capture_failed';}
    finally{
      await network?.close();clearInterval(heartbeat);clearTimeout(timeout);this.active.delete(id);
    }
    await transaction(this.controller.pool,async client=>{
      const current=(await client.query(`SELECT * FROM factory.intakes WHERE id=$1 AND attempt_id=$2 AND status IN ('running','cancelling')
        AND lease_expires_at>clock_timestamp() FOR UPDATE`,[id,attempt])).rows[0];
      if(!current)return;
      if(current.status==='cancelling'){status='cancelled';reason='user_cancelled';specId=null;acceptanceHash=null;}
      else if(current.deadline_at.getTime()<Date.now()){status='needs_review';reason='capture_timeout';}
      for(const artifact of artifacts.records){
        if(status==='cancelled'&&['build_specification','acceptance'].includes(artifact.kind))continue;
        await client.query('INSERT INTO factory.intake_artifacts(id,intake_id,kind,sha256,media_type,bytes) VALUES($1,$2,$3,$4,$5,$6)',[artifact.id,id,artifact.kind,artifact.sha256,artifact.mediaType,artifact.bytes]);
      }
      await client.query('UPDATE factory.intakes SET status=$2,reason=$3,spec_artifact_id=$4,acceptance_sha256=$5,finished_at=clock_timestamp() WHERE id=$1',[id,status,reason,specId,acceptanceHash]);
      await client.query('INSERT INTO factory.intake_events(intake_id,type,data) VALUES($1,$2,$3)',[id,'capture_finished',{status,reason,artifactCount:artifacts.records.length,releaseEligible:false}]);
    });
  }
}
