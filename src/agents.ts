import { randomUUID,createHash } from 'node:crypto';
import { readFile,mkdir,link } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { Controller,ControllerError } from './controller.js';
import { transaction } from './database.js';
import { Environments } from './environments.js';
import { AgentInput,AgentLimits,type AgentRequest,type ProviderAdapter,type ProviderOutcome } from './agent-contracts.js';
import { AgentArtifacts } from './agent-artifacts.js';
import { AgentBrowser } from './agent-browser.js';
import { AgentWorkspace,commitCandidate,assertCandidateSource } from './agent-workspace.js';
import { AgentTools } from './agent-tools.js';
import { CodexAdapter } from './codex-adapter.js';
import {AgentReference} from './agent-reference.js';
import {loadAgentInstructions} from './skills.js';
import {DesignSubmission} from './design.js';
import {DesignProfiles,type AssignedDesignProfile} from './design-profiles.js';

const exec=promisify(execFile);
const QUEUE='factory-agent-v1';
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
export const AgentResumeInput=z.object({prompt:z.string().trim().min(1).max(16000),limits:AgentLimits}).strict();
export class Agents {
  private active=new Map<string,AbortController>();
  private registration?:string;
  private timer?:ReturnType<typeof setInterval>;
  private checking:Promise<unknown>|null=null;
  constructor(readonly controller:Controller,readonly environments:Environments,readonly adapter:ProviderAdapter=new CodexAdapter(controller.config)){}
  private get config(){return this.controller.config;}
  private directory(id:string){return join(this.config.agentRoot,'runs',id);}
  private async instructions(role:Parameters<typeof loadAgentInstructions>[0],selection=this.config.skillsetVersion,preferences?:Parameters<typeof loadAgentInstructions>[2],profile?:AssignedDesignProfile|null){return loadAgentInstructions(role,selection,preferences,profile);}
  async open(){
    await mkdir(this.config.agentRoot,{recursive:true,mode:0o700});
    const options={retryLimit:0,expireInSeconds:900,retentionSeconds:86400};
    await this.controller.boss.createQueue(QUEUE,options);await this.controller.boss.updateQueue(QUEUE,options);
    await this.recover();
    this.registration=await this.controller.boss.work<{runId:string}>(QUEUE,{pollingIntervalSeconds:0.5,localConcurrency:1},async jobs=>{
      for(const job of jobs)await this.perform(job.data.runId);
    });
    this.timer=setInterval(()=>{
      if(!this.checking)this.checking=this.recover().catch(()=>console.error(JSON.stringify({event:'agent_recovery_error'}))).finally(()=>this.checking=null);
    },5000);
    return this;
  }
  async close(){
    clearInterval(this.timer);
    for(const abort of this.active.values())abort.abort('controller_shutdown');
    if(this.checking)await this.checking;
    if(this.registration)await this.controller.boss.offWork(QUEUE,{id:this.registration,wait:true});
  }
  private async owned(owner:string,id:string){
    const row=(await this.controller.pool.query(`SELECT r.* FROM factory.agent_runs r JOIN factory.projects p ON p.id=r.project_id
      WHERE r.id=$1 AND p.owner_id=$2`,[id,owner])).rows[0];
    if(!row)throw new ControllerError('not_found',404);return row;
  }
  async create(owner:string,raw:unknown,parent?:any,internal?:{buildId:string;step:'design'|'builder';selection?:string}){
    const input=AgentInput.parse(raw);
    const brief=input.intakeId?(await this.controller.pool.query(`SELECT i.brief FROM factory.intakes i JOIN factory.projects p ON p.id=i.project_id
      WHERE i.id=$1 AND p.owner_id=$2`,[input.intakeId,owner])).rows[0]?.brief:undefined;
    const assignedDesign=input.designId?(await this.controller.pool.query(`SELECT d.skill_versions,r.design_profile_id FROM factory.design_records d
      JOIN factory.projects p ON p.id=d.project_id JOIN factory.agent_runs r ON r.id=d.run_id WHERE d.id=$1 AND p.owner_id=$2`,[input.designId,owner])).rows[0]:undefined;
    const selection=parent?.skill_versions?.selection??assignedDesign?.skill_versions?.selection??internal?.selection??this.config.skillsetVersion,profiles=new DesignProfiles(this.controller,this.adapter),pinned=parent??assignedDesign;
    const profile=selection!=='v1'&&['designer','builder','visual_reviewer'].includes(input.role)?(pinned?pinned.design_profile_id?await profiles.assigned(owner,pinned.design_profile_id):null:await profiles.select(owner,brief?.design)):null;
    const loaded=await this.instructions(input.role,selection,brief?.design??{skillPacks:[]},profile);
    if(assignedDesign)for(const [key,value]of Object.entries(assignedDesign.skill_versions))if(key.endsWith('_sha256')&&loaded.skillVersions[key]&&loaded.skillVersions[key]!==value)
      throw new ControllerError('design_skill_content_changed');
    return transaction(this.controller.pool,async client=>{
      if(internal){
        const build=(await client.query(`SELECT b.project_id,b.intake_id,b.status FROM factory.build_runs b JOIN factory.projects p ON p.id=b.project_id
          WHERE b.id=$1 AND p.owner_id=$2 FOR UPDATE OF b`,[internal.buildId,owner])).rows[0];if(!build)throw new ControllerError('not_found',404);
        if(['prototype_ready','needs_review','cancelled','cancelling'].includes(build.status)||build.intake_id!==input.intakeId)throw new ControllerError('build_not_active');
        const previous=(await client.query('SELECT id,status FROM factory.agent_runs WHERE build_id=$1 AND build_step=$2',[internal.buildId,internal.step])).rows[0];
        if(previous)return{id:previous.id,status:previous.status,releaseEligible:false};
      }
      let environment:any,projectId:string;
      if(input.environmentId){
        environment=(await client.query(`SELECT e.* FROM factory.environments e JOIN factory.projects p ON p.id=e.project_id
          WHERE e.id=$1 AND p.owner_id=$2 FOR UPDATE OF e`,[input.environmentId,owner])).rows[0];
        if(!environment)throw new ControllerError('not_found',404);
        if(input.projectId&&input.projectId!==environment.project_id)throw new ControllerError('project_environment_mismatch');
        if(environment.status!=='running'||environment.current_operation_id)throw new ControllerError('environment_not_running');
        if((await client.query("SELECT 1 FROM factory.visual_reviews v JOIN factory.agent_runs r ON r.id=v.candidate_run_id WHERE (r.environment_id=$1 OR v.qa_environment_id=$1) AND v.status IN ('queued','running','cancelling')",[environment.id])).rowCount)throw new ControllerError('visual_review_active');
        if((await client.query("SELECT 1 FROM factory.functional_reviews v JOIN factory.agent_runs r ON r.id=v.candidate_run_id WHERE (r.environment_id=$1 OR v.qa_environment_id=$1) AND v.status IN ('queued','running','cancelling')",[environment.id])).rowCount)throw new ControllerError('functional_review_active');
        projectId=environment.project_id;
      }else{
        const project=(await client.query('SELECT * FROM factory.projects WHERE id=$1 AND owner_id=$2 FOR UPDATE',[input.projectId,owner])).rows[0];
        if(!project)throw new ControllerError('not_found',404);
        if(project.site_type!=='wordpress')throw new ControllerError('design_profile_not_implemented');
        projectId=project.id;
      }
      if(input.intakeId){
        const reference=await client.query("SELECT theme_bundle_id FROM factory.intakes WHERE id=$1 AND project_id=$2 AND status='completed'",[input.intakeId,projectId]);
        if(!reference.rowCount)throw new ControllerError('reference_specification_unavailable');
        if(environment&&environment.theme_bundle_id!==reference.rows[0].theme_bundle_id)throw new ControllerError('theme_bundle_intake_mismatch');
      }
      if(internal){const build=(await client.query('SELECT project_id,intake_id FROM factory.build_runs WHERE id=$1',[internal.buildId])).rows[0];
        if(build.project_id!==projectId||build.intake_id!==input.intakeId)throw new ControllerError('build_agent_scope_mismatch');}
      if(input.designId){
        const design=await client.query('SELECT 1 FROM factory.design_records WHERE id=$1 AND project_id=$2 AND intake_id=$3',[input.designId,projectId,input.intakeId??null]);
        if(!design.rowCount)throw new ControllerError('design_record_unavailable');
      }
      const active=environment?await client.query("SELECT 1 FROM factory.agent_runs WHERE environment_id=$1 AND status IN ('queued','running','cancelling')",[environment.id]):
        await client.query("SELECT 1 FROM factory.agent_runs WHERE project_id=$1 AND environment_id IS NULL AND status IN ('queued','running','cancelling')",[projectId]);
      if(active.rowCount)throw new ControllerError('agent_run_active');
      if(parent){
        const last=(await client.query('SELECT id FROM factory.agent_runs WHERE session_key=$1 ORDER BY created_at DESC LIMIT 1',[parent.session_key])).rows[0];
        if(last?.id!==parent.id)throw new ControllerError('resume_latest_run');
      }
      const id=randomUUID(),session=parent?.session_key??randomUUID();
      await client.query(`INSERT INTO factory.agent_runs(id,project_id,environment_id,parent_run_id,session_key,provider,model,role,prompt,status,
        instructions_sha256,skill_versions,limits,provider_session_id,intake_id,input_design_id,design_profile_id,build_id,build_step,publish_source_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [id,projectId,environment?.id??null,parent?.id??null,session,this.adapter.name,this.config.codexModel,input.role,input.prompt,
        loaded.instructionsHash,loaded.skillVersions,input.limits,parent?.provider_session_id??null,input.intakeId??null,input.designId??null,profile?.id??null,internal?.buildId??null,internal?.step??null,input.publishExistingSourceSha256??null]);
      await this.controller.boss.send(QUEUE,{runId:id},{db:{executeSql:(text,values)=>client.query(text,values)}});
      return{id,status:'queued',releaseEligible:false};
    });
  }
  async inspect(owner:string,id:string){
    const row=await this.owned(owner,id);
    const events=(await this.controller.pool.query('SELECT id,type,data,at FROM factory.agent_events WHERE run_id=$1 ORDER BY id',[id])).rows;
    const artifacts=(await this.controller.pool.query('SELECT id,kind,sha256,media_type,bytes,candidate_revision FROM factory.agent_artifacts WHERE run_id=$1 ORDER BY created_at',[id])).rows;
    return{...row,releaseEligible:false,events,artifacts};
  }
  async cancel(owner:string,id:string){
    await this.owned(owner,id);
    const result=await transaction(this.controller.pool,async client=>{
      const row=(await client.query('SELECT * FROM factory.agent_runs WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(!['queued','running','cancelling'].includes(row.status))return{id,status:row.status};
      const status=row.status==='queued'?'cancelled':'cancelling';
      await client.query(`UPDATE factory.agent_runs SET status=$2,reason='user_cancelled',finished_at=CASE WHEN $2='cancelled' THEN clock_timestamp() END WHERE id=$1`,[id,status]);
      return{id,status};
    });
    this.active.get(id)?.abort('user_cancelled');return result;
  }
  async resume(owner:string,id:string,raw:unknown){
    const parent=await this.owned(owner,id);const input=AgentResumeInput.parse(raw);
    if(['queued','running','cancelling'].includes(parent.status))throw new ControllerError('agent_run_active');
    if(parent.model!==this.config.codexModel)throw new ControllerError('resume_model_changed');
    return this.create(owner,{environmentId:parent.environment_id??undefined,projectId:parent.project_id,intakeId:parent.intake_id??undefined,designId:parent.input_design_id??undefined,role:parent.role,prompt:input.prompt,limits:input.limits},parent);
  }
  async artifact(owner:string,id:string,artifactId:string){
    const row=await this.owned(owner,id);
    const metadata=(await this.controller.pool.query('SELECT * FROM factory.agent_artifacts WHERE id=$1 AND run_id=$2',[artifactId,row.id])).rows[0];
    if(!metadata)throw new ControllerError('not_found',404);
    const bytes=await readFile(join(this.directory(row.id),'artifacts',metadata.id));
    if(createHash('sha256').update(bytes).digest('hex')!==metadata.sha256)throw new ControllerError('artifact_hash_mismatch');
    return{metadata,bytes};
  }
  private async valid(id:string,attempt:string){
    const row=(await this.controller.pool.query(`SELECT r.status FROM factory.agent_runs r LEFT JOIN factory.environments e ON e.id=r.environment_id
      WHERE r.id=$1 AND r.attempt_id=$2 AND r.status='running' AND r.lease_expires_at>clock_timestamp()
      AND r.deadline_at>clock_timestamp() AND (r.environment_id IS NULL OR (e.status='running' AND e.current_operation_id IS NULL))`,[id,attempt])).rows[0];
    if(!row)throw new Error('agent_authority_revoked');
  }
  private async event(id:string,attempt:string,type:string,data:Record<string,unknown>){
    await transaction(this.controller.pool,async client=>{
      const row=await client.query(`SELECT id FROM factory.agent_runs WHERE id=$1 AND attempt_id=$2 AND status IN ('running','cancelling')
        AND lease_expires_at>clock_timestamp() FOR UPDATE`,[id,attempt]);
      if(!row.rowCount)throw new Error('agent_authority_revoked');
      if(type==='session_started')await client.query('UPDATE factory.agent_runs SET provider_session_id=$2 WHERE id=$1',[id,data.sessionId]);
      if(type==='turn_started')await client.query('UPDATE factory.agent_runs SET provider_turn_id=$2 WHERE id=$1',[id,data.turnId]);
      if(type==='browser_started')await client.query('UPDATE factory.agent_runs SET browser_id=$2 WHERE id=$1',[id,data.browserId]);
      await client.query('INSERT INTO factory.agent_events(run_id,type,data) VALUES($1,$2,$3)',[id,type,data]);
    });
  }
  private async stopNative(id:string,browserId?:string){
    await exec('python3',[resolve('tools/agent_sandbox.py'),'stop',id],{env:{...process.env,FACTORY_AGENT_ROOT:this.config.agentRoot},timeout:25_000});
    if(browserId)await exec('systemctl',['--user','stop','factory_browser_'+browserId.replaceAll('-','')+'.scope'],{timeout:25_000}).catch(()=>{});
  }
  async recover(){
    const lost=(await this.controller.pool.query(`SELECT * FROM factory.agent_runs WHERE status IN ('running','cancelling') AND lease_expires_at<clock_timestamp()`)).rows;
    for(const row of lost){
      await this.stopNative(row.id,row.browser_id);
      // Wait for the UUID-scoped native lock before permitting another writer.
      if(row.environment_id)await this.environments.runtime('status',row.environment_id).catch(()=>{});
      await this.controller.pool.query(`UPDATE factory.agent_runs SET status=CASE WHEN status='cancelling' THEN 'cancelled' ELSE 'needs_review' END,
        reason='worker_interrupted',usage=jsonb_build_object('confirmed',false,'reservedTokens',(limits->>'maxObservedTokens')::integer),
        finished_at=clock_timestamp() WHERE id=$1 AND attempt_id=$2 AND lease_expires_at<clock_timestamp()`,[row.id,row.attempt_id]);
    }
    const queued=(await this.controller.pool.query(`SELECT id FROM factory.agent_runs WHERE status='queued' AND created_at<clock_timestamp()-interval '15 seconds'`)).rows;
    for(const row of queued)await this.controller.boss.send(QUEUE,{runId:row.id});
  }
  private async perform(id:string){
    const attempt=randomUUID();
    const row=(await this.controller.pool.query(`UPDATE factory.agent_runs SET status='running',attempt_id=$2,lease_expires_at=clock_timestamp()+interval '30 seconds',
      deadline_at=clock_timestamp()+((limits->>'maxRuntimeMs')::integer*interval '1 millisecond'),started_at=clock_timestamp()
      WHERE id=$1 AND status='queued' RETURNING *`,[id,attempt])).rows[0];
    if(!row)return;
    const abort=new AbortController();this.active.set(id,abort);
    const deadline=setTimeout(()=>abort.abort('runtime_budget_exceeded'),Math.max(1,row.deadline_at.getTime()-Date.now()));
    let heartbeatBusy=false;
    const heartbeat=setInterval(()=>{
      if(heartbeatBusy)return;heartbeatBusy=true;
      void this.controller.pool.query(`UPDATE factory.agent_runs SET lease_expires_at=clock_timestamp()+interval '30 seconds'
        WHERE id=$1 AND attempt_id=$2 AND status IN ('running','cancelling') AND lease_expires_at>clock_timestamp() RETURNING status`,[id,attempt])
        .then(result=>{if(!result.rowCount)abort.abort('lease_lost');else if(result.rows[0].status==='cancelling')abort.abort('user_cancelled');})
        .catch(()=>abort.abort('lease_lost')).finally(()=>heartbeatBusy=false);
    },5000);
    const artifacts=new AgentArtifacts(join(this.directory(id),'artifacts'),row.limits.maxArtifactBytes);
    let browser:AgentBrowser|undefined,tools:AgentTools|undefined,design:DesignSubmission|undefined;
    let outcome:ProviderOutcome={status:'needs_review',sessionId:row.provider_session_id,turnId:null,text:'',
      usage:{inputTokens:0,cachedInputTokens:0,outputTokens:0,totalTokens:0,costMicros:null,confirmed:false},errorCode:'agent_failed'};
    let candidate:Awaited<ReturnType<typeof commitCandidate>>|undefined;
    try{
      await this.valid(id,attempt);
      if(row.provider!==this.adapter.name||row.model!==this.config.codexModel)throw new Error('provider_configuration_changed');
      const selectedBrief=row.intake_id?(await this.controller.pool.query('SELECT brief FROM factory.intakes WHERE id=$1',[row.intake_id])).rows[0]?.brief:undefined;
      const profile=row.design_profile_id?await new DesignProfiles(this.controller,this.adapter).assigned(this.config.ownerId,row.design_profile_id):null;
      const loaded=await this.instructions(row.role,row.skill_versions.selection??this.config.skillsetVersion,selectedBrief?.design??{skillPacks:[]},profile);
      if(loaded.instructionsHash!==row.instructions_sha256||loaded.skillVersions.factory_skillset_sha256!==row.skill_versions.factory_skillset_sha256)throw new Error('instruction_version_changed');
      await artifacts.save('agent_instructions','text/markdown',loaded.instructions);
      let workspace:AgentWorkspace|undefined,before:{sha256:string}|undefined,assignedTheme:any;
      if(row.environment_id){
        const environment=(await this.controller.pool.query(`SELECT e.preview_port,t.id AS theme_id,t.source_digest,t.manifest->'versions' AS versions
          FROM factory.environments e LEFT JOIN factory.theme_bundles t ON t.id=e.theme_bundle_id WHERE e.id=$1`,[row.environment_id])).rows[0];
        if(!environment)throw new Error('environment_unavailable');
        assignedTheme={bundleId:environment.theme_id,sourceDigest:environment.source_digest,versions:environment.versions};
        const secret=JSON.parse(await readFile(join(this.config.environmentRoot,'instances',row.environment_id,'private.json'),'utf8'));
        browser=new AgentBrowser(`http://127.0.0.1:${environment.preview_port}`,secret.previewToken,artifacts,abort.signal);
        await this.event(id,attempt,'browser_started',{browserId:browser.id});await browser.open();
        workspace=new AgentWorkspace(this.environments,row.environment_id);before=await workspace.export();
        if(row.publish_source_sha256&&before.sha256!==row.publish_source_sha256)throw new Error('existing_source_changed');
      }
      const reference=row.intake_id?await new AgentReference(this.controller,row.project_id,row.intake_id,row.skill_versions.selection??this.config.skillsetVersion).open():undefined;
      design=row.role==='designer'&&reference?new DesignSubmission(reference,artifacts):undefined;
      tools=new AgentTools(workspace,browser,artifacts,row.role==='builder',row.limits.maxToolCalls,()=>this.valid(id,attempt),reference,design,row.skill_versions.selection!=='v1');
      await artifacts.save('agent_capabilities','application/json',JSON.stringify({role:row.role,tools:tools.definitions,limits:row.limits,
        environmentId:row.environment_id,intakeId:row.intake_id,designId:row.input_design_id,designProfileId:row.design_profile_id,themeBundle:assignedTheme??null,browserTransport:'chromium-cdp-fetch-v1',browserSummaryVersion:'compact-v1'}));
      const initial=browser?await tools.initial():undefined;
      const referenceImage=await reference?.initial();
      if(initial)await this.event(id,attempt,'initial_observation',{observation:initial.observation});
      let assignedDesign='';
      if(row.input_design_id){
        const record=(await this.controller.pool.query(`SELECT d.*,p.owner_id FROM factory.design_records d JOIN factory.projects p ON p.id=d.project_id
          WHERE d.id=$1 AND d.project_id=$2 AND d.intake_id=$3`,[row.input_design_id,row.project_id,row.intake_id])).rows[0];
        if(!record)throw new Error('design_record_unavailable');
        const document=await this.artifact(record.owner_id,record.run_id,record.markdown_artifact_id);
        assignedDesign='\n\nAssigned protected DESIGN.md:\n'+document.bytes.toString();
      }
      outcome=await this.adapter.run({runId:id,sessionKey:row.session_key,sessionId:row.provider_session_id??undefined,role:row.role,
        prompt:row.prompt+(assignedTheme?'\n\nAssigned immutable MainTheme bundle:\n'+JSON.stringify(assignedTheme):'')+(initial?'\n\nCurrent observed preview (not a complete site analysis):\n'+JSON.stringify(initial.observation):'')+
          (reference?'\n\nAn immutable reference specification is assigned. Use factory_reference overview for its brief, routes, flows, screenshot/HTML/CSS IDs, assumptions and protected requirements.':'')+
          (design?'\n\nSubmit the complete design with factory_design before finishing. Include every required page, every required acceptance requirementId and every supplied assumption key. '+
            (reference!.context().specification.reference.states.length?'Include a matched screenshot/HTML/structure evidence triple from one observed reference state.':
              'This is a custom-direction brief without reference captures. Do not invent observed reference states; record client-provided facts and unknowns honestly.')+
            ' Without a valid submission the run cannot complete.':'')+assignedDesign,
        instructions:loaded.instructions,instructionsHash:row.instructions_sha256,skillVersions:row.skill_versions,limits:row.limits,
        tools:tools.definitions,images:[...(initial?[{dataUrl:initial.image,label:'CURRENT client preview screenshot. This is the editable site.'}]:[]),...(referenceImage?[referenceImage]:[])]},{signal:abort.signal,onEvent:(type,data)=>this.event(id,attempt,type,data),onTool:(name,args)=>tools!.invoke(name,args)});
      await tools.settled();
      if(outcome.status==='completed'){
        await this.valid(id,attempt);
        if(row.role==='designer'&&!design?.value)throw new Error('design_submission_missing');
        if(workspace&&browser){
          const checked=await workspace.call('check');if(!checked.valid)throw new Error('candidate_syntax_invalid');
          const source=await workspace.export();
          if(row.role==='builder')assertCandidateSource(before!.sha256,source.sha256,row.publish_source_sha256);
          if(row.role==='builder')candidate=await commitCandidate(join(this.directory(id),'candidate'),source,artifacts);
          const final=await browser.act({action:'navigate',path:'/'});
          if(browser.httpStatus!==200)throw new Error('candidate_preview_failed');
          if((await workspace.export()).sha256!==source.sha256)throw new Error('candidate_source_changed');
          await this.event(id,attempt,'final_observation',{observation:final.after,candidateRevision:candidate?.revision??null});
        }
      }
    }catch(error){
      const code=error instanceof Error&&/^[a-z_]{3,100}$/.test(error.message)?error.message:'agent_execution_failed';
      outcome={...outcome,status:abort.signal.reason==='user_cancelled'?'cancelled':'needs_review',errorCode:code};candidate=undefined;
    }finally{
      await tools?.settled();await browser?.close();
      await this.stopNative(id).catch(()=>{});
      clearTimeout(deadline);clearInterval(heartbeat);this.active.delete(id);
    }
    await transaction(this.controller.pool,async client=>{
      const current=(await client.query(`SELECT * FROM factory.agent_runs WHERE id=$1 AND attempt_id=$2 AND status IN ('running','cancelling')
        AND lease_expires_at>clock_timestamp() FOR UPDATE`,[id,attempt])).rows[0];
      if(!current)return;
      if(current.status==='cancelling'){outcome.status='cancelled';outcome.errorCode='user_cancelled';candidate=undefined;}
      if(outcome.status==='completed'){
        const available=row.environment_id?await client.query("SELECT 1 FROM factory.environments WHERE id=$1 AND status='running' AND current_operation_id IS NULL FOR SHARE",[row.environment_id]):null;
        if(available&&!available.rowCount||current.deadline_at.getTime()<Date.now()){outcome.status='needs_review';outcome.errorCode='publication_authority_expired';candidate=undefined;}
      }
      const publishedDesign=outcome.status==='completed'?design?.value:undefined;
      for(const artifact of artifacts.records){
        if(artifact.kind==='candidate_source'&&!candidate)continue;
        if(['design_record','design_markdown'].includes(artifact.kind)&&!publishedDesign)continue;
        await client.query(`INSERT INTO factory.agent_artifacts(id,run_id,kind,sha256,media_type,bytes,candidate_revision) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [artifact.id,id,artifact.kind,artifact.sha256,artifact.mediaType,artifact.bytes,candidate?artifact.candidateRevision:null]);
      }
      if(publishedDesign){
        await client.query(`INSERT INTO factory.design_records(id,run_id,project_id,intake_id,acceptance_sha256,record_artifact_id,markdown_artifact_id,instructions_sha256,skill_versions)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[publishedDesign.record.id,id,row.project_id,row.intake_id,publishedDesign.document.acceptanceHash,publishedDesign.record.id,publishedDesign.markdown.id,row.instructions_sha256,row.skill_versions]);
        const directory=join(this.directory(id),'design');await mkdir(directory,{recursive:true,mode:0o700});
        await link(join(this.directory(id),'artifacts',publishedDesign.markdown.id),join(directory,'DESIGN.md'));
      }
      await client.query(`UPDATE factory.agent_runs SET status=$2,provider_session_id=$3,provider_turn_id=$4,usage=$5,summary=$6,reason=$7,
        candidate_revision=$8,source_digest=$9,design_record_id=$10,finished_at=clock_timestamp() WHERE id=$1`,
        [id,outcome.status,outcome.sessionId,outcome.turnId,outcome.usage,outcome.text,outcome.errorCode??null,candidate?.revision??null,candidate?.sourceDigest??null,publishedDesign?.record.id??null]);
      await client.query('INSERT INTO factory.agent_events(run_id,type,data) VALUES($1,$2,$3)',[id,'run_finished',{status:outcome.status,releaseEligible:false}]);
    });
  }
}
