import {randomUUID} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {Controller,ControllerError} from './controller.js';
import {transaction} from './database.js';
import {BuildInput,type BuildRequest} from './build-contracts.js';
import type {Environments} from './environments.js';
import type {Agents} from './agents.js';
import {AgentArtifacts} from './agent-artifacts.js';
import {BuildRuntime} from './build-runtime.js';
import {canonicalJson,sha256} from './immutable.js';
import {ensureThemeBaseline,selectTheme} from './themes.js';
import {verifyBuild} from './build-verification.js';

const QUEUE='factory-build-v1',terminal=['prototype_ready','needs_review','cancelled'];
export class Builds {
  private registration?:string;private timer?:ReturnType<typeof setInterval>;private checking:Promise<unknown>|null=null;
  private active=new Map<string,AbortController>();readonly runtime:BuildRuntime;
  constructor(readonly controller:Controller,readonly environments:Environments,readonly agents:Agents){this.runtime=new BuildRuntime(controller,environments);}
  private directory(id:string){return join(this.controller.config.buildRoot,'runs',id);}
  async open(){
    await mkdir(this.controller.config.buildRoot,{recursive:true,mode:0o700});await ensureThemeBaseline(this.controller);
    const options={retryLimit:0,expireInSeconds:900,retentionSeconds:86400};await this.controller.boss.createQueue(QUEUE,options);await this.controller.boss.updateQueue(QUEUE,options);
    await this.recover();this.registration=await this.controller.boss.work<{buildId:string}>(QUEUE,{pollingIntervalSeconds:0.5,localConcurrency:1},async jobs=>{for(const job of jobs)await this.reconcile(job.data.buildId);});
    this.timer=setInterval(()=>{if(!this.checking)this.checking=this.recover().catch(()=>console.error(JSON.stringify({event:'build_recovery_failed'}))).finally(()=>this.checking=null);},5000);return this;
  }
  async close(){clearInterval(this.timer);for(const abort of this.active.values())abort.abort('controller_shutdown');if(this.checking)await this.checking;
    if(this.registration)await this.controller.boss.offWork(QUEUE,{id:this.registration,wait:true});}
  private async owned(owner:string,id:string){const row=(await this.controller.pool.query(`SELECT b.* FROM factory.build_runs b JOIN factory.projects p ON p.id=b.project_id
    WHERE b.id=$1 AND p.owner_id=$2`,[id,owner])).rows[0];if(!row)throw new ControllerError('not_found',404);return row;}
  async create(owner:string,raw:unknown){
    const input=BuildInput.parse(raw);await ensureThemeBaseline(this.controller);
    const intake=(await this.controller.pool.query(`SELECT i.* FROM factory.intakes i JOIN factory.projects p ON p.id=i.project_id WHERE i.id=$1 AND p.owner_id=$2`,[input.intakeId,owner])).rows[0];
    if(!intake)throw new ControllerError('not_found',404);if(intake.status!=='completed')throw new ControllerError('reference_specification_unavailable');
    if(!['fa','fa-IR','en','en-US'].includes(intake.brief.language))throw new ControllerError('build_locale_not_certified');
    if(intake.brief.features.some((feature:string)=>!['commerce','search','accounts'].includes(feature)))throw new ControllerError('build_feature_not_supported');
    const suppliedPages=new Set(input.content.pages.map(page=>page.path)),productPaths=new Set(input.content.products.map(product=>'/product/'+product.key+'/'));
    if(intake.brief.pages.some((page:any)=>page.required&&!suppliedPages.has(page.path)&&!productPaths.has(page.path)))throw new ControllerError('build_required_page_content_missing');
    if(intake.brief.features.includes('commerce')){
      for(const kind of ['shop','cart','checkout'])if(!input.content.pages.some(page=>page.kind===kind))throw new ControllerError('build_commerce_page_missing');
      if(!input.content.products.length)throw new ControllerError('build_catalog_required');
    }
    if(intake.brief.features.includes('accounts')&&!input.content.pages.some(page=>page.kind==='account'))throw new ControllerError('build_account_page_missing');
    if(input.designId&&!(await this.controller.pool.query('SELECT 1 FROM factory.design_records WHERE id=$1 AND intake_id=$2 AND project_id=$3',[input.designId,input.intakeId,intake.project_id])).rowCount)throw new ControllerError('design_record_unavailable');
    const fonts=(await this.controller.pool.query("SELECT id FROM factory.project_assets WHERE project_id=$1 AND id=ANY($2::uuid[]) AND media_type LIKE 'font/%'",[intake.project_id,intake.brief.assetIds])).rows.map(row=>row.id);
    const assets=await this.runtime.assets(intake.project_id,input.content,fonts);
    if(assets.some(asset=>!intake.brief.assetIds.includes(asset.id)))throw new ControllerError('build_asset_not_in_brief');
    input.maxObservedTokens=Math.min(input.maxObservedTokens,intake.brief.budget.maxObservedTokens);
    input.maxRuntimeMs=Math.min(input.maxRuntimeMs,intake.brief.budget.maxRuntimeMs);
    if(input.agentLimits.maxObservedTokens>input.maxObservedTokens)input.agentLimits.maxObservedTokens=input.maxObservedTokens;
    return transaction(this.controller.pool,async client=>{
      await client.query('SELECT id FROM factory.projects WHERE id=$1 FOR UPDATE',[intake.project_id]);
      if((await client.query("SELECT 1 FROM factory.build_runs WHERE project_id=$1 AND status NOT IN ('prototype_ready','cancelled','needs_review')",[intake.project_id])).rowCount)throw new ControllerError('build_active');
      await selectTheme(this.controller,client,intake.theme_bundle_id);
      const id=randomUUID();await client.query(`INSERT INTO factory.build_runs(id,project_id,intake_id,design_id,status,input,input_sha256,asset_manifest,deadline_at,theme_bundle_id,skillset_version)
        VALUES($1,$2,$3,$4,'queued',$5,$6,$7,clock_timestamp()+($8*interval '1 millisecond'),$9,$10)`,[id,intake.project_id,input.intakeId,input.designId??null,input,
        sha256(canonicalJson(input)),JSON.stringify(assets.map(({id,name,media_type,sha256,bytes})=>({id,name,media_type,sha256,bytes}))),input.maxRuntimeMs,intake.theme_bundle_id,this.controller.config.skillsetVersion]);
      await client.query("INSERT INTO factory.build_events(build_id,type,data) VALUES($1,'build_created',$2)",[id,{intakeId:input.intakeId,themeBundleId:intake.theme_bundle_id,synthetic:input.content.synthetic,releaseEligible:false}]);
      await this.controller.boss.send(QUEUE,{buildId:id},{db:{executeSql:(text,values)=>client.query(text,values)}});return{id,status:'queued',releaseEligible:false};
    });
  }
  async inspect(owner:string,id:string){const row=await this.owned(owner,id);return{...row,releaseEligible:false,
    events:(await this.controller.pool.query('SELECT type,data,at FROM factory.build_events WHERE build_id=$1 ORDER BY id',[id])).rows,
    artifacts:(await this.controller.pool.query('SELECT id,kind,sha256,media_type,bytes,candidate_revision FROM factory.build_artifacts WHERE build_id=$1 ORDER BY created_at',[id])).rows,
    preview:row.environment_id?await this.environments.inspect(owner,row.environment_id).then(environment=>environment.previewUrl).catch(()=>null):null};}
  async artifact(owner:string,id:string,artifactId:string){await this.owned(owner,id);const metadata=(await this.controller.pool.query('SELECT * FROM factory.build_artifacts WHERE build_id=$1 AND id=$2',[id,artifactId])).rows[0];
    if(!metadata)throw new ControllerError('not_found',404);const bytes=await readFile(join(this.directory(id),'artifacts',artifactId));if(sha256(bytes)!==metadata.sha256)throw new ControllerError('artifact_hash_mismatch');return{metadata,bytes};}
  async cancel(owner:string,id:string){const row=await this.owned(owner,id);if(terminal.includes(row.status))return{id,status:row.status};
    await this.controller.pool.query("UPDATE factory.build_runs SET status='cancelling',reason='user_cancelled',updated_at=clock_timestamp() WHERE id=$1 AND status NOT IN ('prototype_ready','needs_review','cancelled')",[id]);
    this.active.get(id)?.abort('user_cancelled');await this.controller.boss.send(QUEUE,{buildId:id});return{id,status:'cancelling'};}
  async recover(){
    const rows=(await this.controller.pool.query(`SELECT id FROM factory.build_runs WHERE status NOT IN ('prototype_ready','needs_review','cancelled')
      AND (lease_expires_at IS NULL OR lease_expires_at<clock_timestamp()) AND updated_at<clock_timestamp()-interval '5 seconds'`)).rows;
    for(const row of rows)await this.controller.boss.send(QUEUE,{buildId:row.id});
  }
  private async valid(id:string,attempt:string){const result=await this.controller.pool.query(`SELECT 1 FROM factory.build_runs WHERE id=$1 AND attempt_id=$2
    AND status NOT IN ('prototype_ready','needs_review','cancelled','cancelling') AND lease_expires_at>clock_timestamp() AND deadline_at>clock_timestamp()`,[id,attempt]);if(!result.rowCount)throw new Error('build_authority_revoked');}
  private async checkpoint(id:string,attempt:string,patch:Record<string,unknown>,event?:object){
    const allowed=new Set(['status','design_run_id','design_id','environment_id','builder_run_id','content_manifest','candidate_revision','source_digest','observed_tokens','usage_confirmed','reason']);
    const entries=Object.entries(patch);if(entries.some(([key])=>!allowed.has(key)))throw new Error('build_checkpoint_invalid');
    return transaction(this.controller.pool,async client=>{
      const row=(await client.query(`SELECT status FROM factory.build_runs WHERE id=$1 AND attempt_id=$2 AND lease_expires_at>clock_timestamp() FOR UPDATE`,[id,attempt])).rows[0];if(!row)throw new Error('build_authority_revoked');
      if(row.status==='cancelling'&&patch.status!==undefined&&patch.status!=='cancelled')throw new Error('build_authority_revoked');
      await client.query(`UPDATE factory.build_runs SET ${entries.map(([key],index)=>`${key}=$${index+3}`).join(',')},updated_at=clock_timestamp() WHERE id=$1 AND attempt_id=$2`,[id,attempt,...entries.map(([,value])=>value)]);
      if(event)await client.query("INSERT INTO factory.build_events(build_id,type,data) VALUES($1,'checkpoint',$2)",[id,event]);
    });
  }
  private async usage(row:any){
    const runs=(await this.controller.pool.query('SELECT id,status,usage,limits FROM factory.agent_runs WHERE build_id=$1',[row.id])).rows;
    return{runs,observed:runs.reduce((sum,run)=>sum+(run.usage?.totalTokens??0),0),confirmed:runs.filter(run=>!['queued','running','cancelling'].includes(run.status)).every(run=>run.usage?.confirmed===true)};
  }
  private async drain(row:any){
    const owner=this.controller.config.ownerId,runs=(await this.controller.pool.query('SELECT id,status FROM factory.agent_runs WHERE build_id=$1',[row.id])).rows;
    for(const run of runs)if(['queued','running','cancelling'].includes(run.status))await this.agents.cancel(owner,run.id);
    return runs.every(run=>!['queued','running','cancelling'].includes(run.status));
  }
  private async agent(row:any,step:'design'|'builder',prompt:string){
    const input=row.input as BuildRequest,usage=await this.usage(row),remaining=input.maxObservedTokens-usage.observed;
    if(!usage.confirmed)throw new Error('build_usage_unconfirmed');if(remaining<1000)throw new Error('build_token_budget_exceeded');
    const availableRuntime=Math.min(input.agentLimits.maxRuntimeMs,row.deadline_at.getTime()-Date.now());if(availableRuntime<1000)throw new Error('build_runtime_budget_exceeded');
    return this.agents.create(this.controller.config.ownerId,{projectId:row.project_id,environmentId:step==='builder'?row.environment_id:undefined,intakeId:row.intake_id,
      designId:step==='builder'?row.design_id:undefined,role:step==='design'?'designer':'builder',prompt,limits:{...input.agentLimits,maxObservedTokens:Math.min(input.agentLimits.maxObservedTokens,remaining),maxRuntimeMs:availableRuntime}},undefined,{buildId:row.id,step,selection:row.skillset_version??this.controller.config.skillsetVersion});
  }
  private async reconcile(id:string){
    const attempt=randomUUID(),row=(await this.controller.pool.query(`UPDATE factory.build_runs SET attempt_id=$2,lease_expires_at=clock_timestamp()+interval '30 seconds'
      WHERE id=$1 AND status NOT IN ('prototype_ready','needs_review','cancelled') AND available_at<=clock_timestamp()
      AND (lease_expires_at IS NULL OR lease_expires_at<clock_timestamp()) RETURNING *`,[id,attempt])).rows[0];if(!row)return;
    const abort=new AbortController();this.active.set(id,abort);const artifacts=new AgentArtifacts(join(this.directory(id),'artifacts'),134217728,row.candidate_revision);
    const deadline=setTimeout(()=>abort.abort('build_runtime_budget_exceeded'),Math.max(1,row.deadline_at.getTime()-Date.now()));
    const heartbeat=setInterval(()=>{void this.controller.pool.query(`UPDATE factory.build_runs SET lease_expires_at=clock_timestamp()+interval '30 seconds'
      WHERE id=$1 AND attempt_id=$2 AND lease_expires_at>clock_timestamp() AND status NOT IN ('prototype_ready','needs_review','cancelled') RETURNING status`,[id,attempt]).then(result=>{
        if(!result.rowCount)abort.abort('lease_lost');else if(result.rows[0].status==='cancelling')abort.abort('user_cancelled');}).catch(()=>abort.abort('lease_lost'));},5000);
    try{
      const input=row.input as BuildRequest;if(sha256(canonicalJson(input))!==row.input_sha256)throw new Error('build_input_hash_mismatch');
      const usage=await this.usage(row);await this.checkpoint(id,attempt,{observed_tokens:usage.observed,usage_confirmed:usage.confirmed});
      if(row.reason&&row.status!=='cancelling'){if(await this.drain(row))await this.checkpoint(id,attempt,{status:'needs_review',reason:row.reason});return;}
      const expired=row.deadline_at.getTime()<Date.now(),overBudget=usage.observed>input.maxObservedTokens||!usage.confirmed;
      if(row.status==='cancelling'||expired||overBudget){
        if(await this.drain(row)){
          if(row.environment_id){const state=await this.environments.inspect(this.controller.config.ownerId,row.environment_id);
            if(state.status==='running'&&!state.current_operation_id)await this.environments.request(this.controller.config.ownerId,row.environment_id,'stop');}
          await this.checkpoint(id,attempt,{status:row.status==='cancelling'?'cancelled':'needs_review',reason:row.status==='cancelling'?'user_cancelled':expired?'build_runtime_budget_exceeded':!usage.confirmed?'build_usage_unconfirmed':'build_token_budget_exceeded'});
        }return;
      }
      await this.valid(id,attempt);const intake=(await this.controller.pool.query('SELECT brief FROM factory.intakes WHERE id=$1',[row.intake_id])).rows[0];
      switch(row.status){
        case'queued':await this.checkpoint(id,attempt,{status:row.design_id?'provisioning':'designing'},{stage:row.design_id?'provisioning':'designing'});break;
        case'designing':{
          if(!row.design_run_id){const run=await this.agent(row,'design',`Create the complete visual direction and MainTheme implementation plan for this exact client brief. Client content is supplied below; do not ask for facts already supplied. Use the resolved customization policy and selected packs. Missing production-only inputs remain explicit delivery dependencies.\n\n${canonicalJson(input.content)}`);await this.checkpoint(id,attempt,{design_run_id:run.id});break;}
          const run=await this.agents.inspect(this.controller.config.ownerId,row.design_run_id);if(['queued','running','cancelling'].includes(run.status))break;
          if(run.status!=='completed'||!run.design_record_id)throw new Error('build_design_failed');
          await this.checkpoint(id,attempt,{design_id:run.design_record_id,status:'provisioning'},{stage:'provisioning',designId:run.design_record_id});break;
        }
        case'provisioning':{
          if(!row.environment_id){const environment=await this.environments.create(this.controller.config.ownerId,{projectId:row.project_id,themeBundleId:row.theme_bundle_id,
            limits:{ttlSeconds:Math.min(86400,Math.max(3600,Math.ceil((row.deadline_at.getTime()-Date.now())/1000)+1800)),retentionSeconds:86400}},{allocationKey:'build:'+id});
            await this.checkpoint(id,attempt,{environment_id:environment.id});break;}
          const environment=await this.environments.inspect(this.controller.config.ownerId,row.environment_id);
          if(['failed','deleted'].includes(environment.status))throw new Error('build_environment_failed');if(environment.current_operation_id)break;
          if(environment.status==='stopped'){await this.environments.request(this.controller.config.ownerId,row.environment_id,'start');break;}
          if(environment.status==='running')await this.checkpoint(id,attempt,{status:'preparing'},{stage:'preparing'});break;
        }
        case'preparing':{
          await this.runtime.prepare(id,row.environment_id,input,intake.brief.language);
          for(const asset of row.asset_manifest){await this.valid(id,attempt);await this.runtime.importAsset(id,row.environment_id,asset);}
          const manifest=await this.runtime.manifest(row.environment_id);await this.valid(id,attempt);
          await artifacts.save('build_content_manifest','application/json',canonicalJson(manifest));
          await this.checkpoint(id,attempt,{content_manifest:manifest,status:'building'},{stage:'building'});break;
        }
        case'building':{
          if(!row.builder_run_id){const run=await this.agent(row,'builder',`Build this entire finished WordPress child-theme website from the assigned DESIGN.md and resolved client policy. All client pages, actual WooCommerce products, demo-commerce settings and media have already been created by the trusted controller. Use the exact IDs and media paths below. Implement the full header/footer, home and every supplied page/product route. Selected client features: ${intake.brief.features.join(', ')||'content pages only'}. Keep the supplied WooCommerce pages functional and reuse native WooCommerce data/blocks and plugin behavior. Do not create static fake product data or embed business logic in the child. Use child source for all layout; no preview-only database/editor changes. Remove inherited factory sample navigation, Persian copy from an English site, sample contact details and unrequested sections. ${intake.brief.features.includes('search')?'Provide a useful native search form with input name s.':'Do not add an unrequested search feature.'} Inspect desktop/mobile renders and verify initial navigation and requested product actions before finishing. No invented business claims or placeholder sections. When the supplied synthetic flag is true, this is a clearly labelled demonstration; do not present it as an actual client’s production site.\n\nPrepared content and media manifest:\n${canonicalJson(row.content_manifest)}\n\nSupplied client content:\n${canonicalJson(input.content)}`);
            await this.checkpoint(id,attempt,{builder_run_id:run.id});break;}
          const run=await this.agents.inspect(this.controller.config.ownerId,row.builder_run_id);if(['queued','running','cancelling'].includes(run.status))break;
          if(run.status!=='completed'||!run.candidate_revision||!run.source_digest)throw new Error('build_builder_failed');
          await this.checkpoint(id,attempt,{candidate_revision:run.candidate_revision,source_digest:run.source_digest,status:'verifying'},{stage:'verifying',candidateRevision:run.candidate_revision});break;
        }
        case'verifying':{
          const report=await verifyBuild(this.environments,row.environment_id,input,row.content_manifest,row.source_digest,artifacts,abort.signal,intake.brief.features,async browserId=>{
            await this.valid(id,attempt);await this.controller.pool.query("INSERT INTO factory.build_events(build_id,type,data) VALUES($1,'browser_started',$2)",[id,{attemptId:attempt,browserId}]);
          });await this.valid(id,attempt);await artifacts.save('initial_build_verification','application/json',canonicalJson(report));
          const usage=await this.usage(row);if(!usage.confirmed)throw new Error('build_usage_unconfirmed');if(usage.observed>input.maxObservedTokens)throw new Error('build_token_budget_exceeded');
          await this.checkpoint(id,attempt,{status:'prototype_ready',reason:null,observed_tokens:usage.observed,usage_confirmed:usage.confirmed},
            {stage:'prototype_ready',candidateRevision:row.candidate_revision,releaseEligible:false});break;
        }
      }
    }catch(error){
      if(abort.signal.reason!=='controller_shutdown'&&abort.signal.reason!=='lease_lost'){
        const current=(await this.controller.pool.query('SELECT status FROM factory.build_runs WHERE id=$1',[id])).rows[0];
        if(current?.status!=='cancelling'){
          const reason=error instanceof Error&&/^[a-z_]{3,100}$/.test(error.message)?error.message:'initial_build_verification_failed';
          await this.checkpoint(id,attempt,{reason}).catch(()=>{});
          if(await this.drain(row))await this.checkpoint(id,attempt,{status:'needs_review',reason}).catch(()=>{});
        }
      }
    }finally{
      clearInterval(heartbeat);clearTimeout(deadline);this.active.delete(id);
      await transaction(this.controller.pool,async client=>{
        const valid=(await client.query('SELECT status,candidate_revision FROM factory.build_runs WHERE id=$1 AND attempt_id=$2 AND lease_expires_at>clock_timestamp() FOR UPDATE',[id,attempt])).rows[0];if(!valid)return;
        for(const artifact of artifacts.records)await client.query('INSERT INTO factory.build_artifacts(id,build_id,kind,sha256,media_type,bytes,candidate_revision) VALUES($1,$2,$3,$4,$5,$6,$7)',[artifact.id,id,artifact.kind,artifact.sha256,artifact.mediaType,artifact.bytes,valid.candidate_revision]);
        await client.query("UPDATE factory.build_runs SET lease_expires_at=NULL,available_at=clock_timestamp()+interval '1 second',updated_at=clock_timestamp() WHERE id=$1 AND attempt_id=$2",[id,attempt]);
        if(!terminal.includes(valid.status))await this.controller.boss.send(QUEUE,{buildId:id},{startAfter:new Date(Date.now()+1000),db:{executeSql:(text,values)=>client.query(text,values)}});
      });
    }
  }
}
