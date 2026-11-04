import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Controller} from '../src/controller.js';
import {loadConfig} from '../src/config.js';
import {Environments} from '../src/environments.js';
import {VisualPreview} from '../src/visual-preview.js';
import {AgentArtifacts} from '../src/agent-artifacts.js';
import {checkAdminProduct} from '../src/admin-qa.js';

const {values}=parseArgs({options:{retainFailed:{type:'boolean'},environment:{type:'string'}}});
// Operator pilot. Uses the running controller's environment worker; no inference worker.
const controller=await new Controller(await loadConfig()).open(),environments=new Environments(controller),id=randomUUID();
const artifacts=new AgentArtifacts(join('.runtime/controller/part-9-pilot',id),67108864),signal=AbortSignal.timeout(1800000);
let preview:VisualPreview|undefined,retain=false,reused:string|undefined;
try{
 const candidate=(await controller.pool.query("SELECT * FROM factory.agent_runs WHERE id=$1 AND status='completed'",['6d2d0b91-ea60-467b-8553-b66cb627a432'])).rows[0];if(!candidate)throw new Error('admin_pilot_candidate_missing');
 artifacts.revision=candidate.candidate_revision;
 let source=await environments.inspect(controller.config.ownerId,candidate.environment_id);
 if(source.status==='stopped')await environments.request(controller.config.ownerId,source.id,'start');
 const until=Date.now()+600000;
 while(source.status!=='running'||source.current_operation_id){signal.throwIfAborted();if(source.status==='failed'||Date.now()>until)throw new Error('admin_pilot_source_unavailable');await new Promise(done=>setTimeout(done,1000));source=await environments.inspect(controller.config.ownerId,source.id);}
 preview=new VisualPreview(controller,environments,{id,attempt_id:randomUUID(),project_id:candidate.project_id,source_digest:candidate.source_digest,input:{maxRuntimeMs:1800000}},signal,
  async(type,data)=>{console.log(JSON.stringify({type,...data}));});
 const {environment,provenance}=values.environment?{environment:await environments.inspect(controller.config.ownerId,values.environment),provenance:{reusedEnvironmentId:values.environment}}:await preview.open(source);
 if(environment.project_id!==candidate.project_id)throw new Error('admin_pilot_project_mismatch');
 if(values.environment){
  const metadata=JSON.parse(await readFile(join(controller.config.environmentRoot,'instances',environment.id,'private.json'),'utf8'));
  if(environment.id===candidate.environment_id||metadata.visualClone?.sourceEnvironmentId!==candidate.environment_id||metadata.visualClone?.sourceDigest!==candidate.source_digest)throw new Error('admin_pilot_clone_required');
  reused=environment.id;
 }await artifacts.save('admin_preview_provenance','application/json',JSON.stringify(provenance));
 const report=await checkAdminProduct(environments,controller.config.ownerId,environment.id,{revision:candidate.candidate_revision,sourceDigest:candidate.source_digest,sourceEnvironmentId:candidate.environment_id},artifacts,signal);
 await writeFile(join(artifacts.directory,'result.json'),JSON.stringify({id,report,artifacts:artifacts.records.map(({filename,...metadata})=>metadata)}),{mode:0o600});
 console.log(JSON.stringify({id,passed:report.passed,reason:report.reason,cleanupVerified:report.cleanupVerified,evidenceStates:report.evidence.length}));
 if(!report.passed){process.exitCode=1;retain=values.retainFailed===true; if(retain)console.log(JSON.stringify({retainedEnvironmentId:environment.id,scope:'Disposable QA clone; existing expiry/retention still apply.'}));}
}finally{
 try{
 if(preview&&!retain)await preview.close();
 if(reused&&!retain){await environments.request(controller.config.ownerId,reused,'destroy');const until=Date.now()+120000;while((await environments.inspect(controller.config.ownerId,reused)).status!=='deleted'){if(Date.now()>until)throw new Error('admin_pilot_cleanup_timeout');await new Promise(done=>setTimeout(done,500));}}
 }finally{await controller.close();}
}
