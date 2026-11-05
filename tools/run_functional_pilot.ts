import {parseArgs} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {loadConfig} from '../src/config.js';
import {FunctionalPlan} from '../src/functional-plan.js';
import {sha256,canonicalJson} from '../src/immutable.js';

const {values}=parseArgs({options:{create:{type:'boolean'},candidate:{type:'string'},plan:{type:'string'},directory:{type:'string'}}});
const config=await loadConfig(),directory=values.directory??'.runtime/controller/part-9-full-pilot',filename=join(directory,'state.json'),origin=`http://${config.host==='::1'?'[::1]':config.host}:${config.port}`;
async function api(path:string,body?:unknown){
 const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+config.apiToken,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`Functional pilot API HTTP ${response.status}`);return response.json()as Promise<any>;
}
await mkdir(directory,{recursive:true,mode:0o700});
let state:{reviewId:string;candidateRunId:string;planSha256:string};
try{state=JSON.parse(await readFile(filename,'utf8'));}
catch(error){
 if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
 if(!values.create||!values.candidate||!values.plan)throw new Error('First run requires --create --candidate UUID --plan FILE; later runs inspect the saved job.');
 const candidate=z.uuid().parse(values.candidate),plan=FunctionalPlan.parse(JSON.parse(await readFile(values.plan,'utf8'))),run=await api('/v1/agent-runs/'+candidate);
 let environment=await api('/v1/environments/'+run.environment_id);
 if(environment.status==='stopped')await api('/v1/environments/'+environment.id+'/start',{});
 const until=Date.now()+600000;
 while(environment.status!=='running'||environment.current_operation_id){if(environment.status==='failed'||Date.now()>until)throw new Error('functional_pilot_source_unavailable');await new Promise(done=>setTimeout(done,1000));environment=await api('/v1/environments/'+environment.id);}
 const created=await api('/v1/functional-reviews',{candidateRunId:candidate,plan,maxRuntimeMs:3600000});
 state={reviewId:created.id,candidateRunId:candidate,planSha256:sha256(canonicalJson(plan))};await writeFile(filename,JSON.stringify(state),{mode:0o600,flag:'wx'});
}
if(values.candidate&&state.candidateRunId!==values.candidate)throw new Error('Saved functional pilot belongs to another candidate.');
if(values.plan){const supplied=FunctionalPlan.parse(JSON.parse(await readFile(values.plan,'utf8')));if(state.planSha256!==sha256(canonicalJson(supplied)))throw new Error('Saved functional pilot has a different protected plan; use another directory.');}

let previous='';
for(;;){
 const row=await api('/v1/functional-reviews/'+state.reviewId),module=row.events.filter((e:any)=>e.type==='check_started').at(-1)?.data??null;
 const summary=JSON.stringify({id:row.id,status:row.status,reason:row.reason,module,requiresRepair:row.report?.requiresRepair??null,requiresReview:row.report?.requiresReview??null,coverageComplete:row.report?.coverageComplete??null});if(previous!==summary){console.log(summary);previous=summary;}
 if(!['queued','running','cancelling'].includes(row.status)){await writeFile(join(directory,'result.json'),JSON.stringify(row),{mode:0o600});if(row.status!=='reviewed'||row.report?.coverageComplete!==true||row.report?.requiresRepair!==false||row.report?.requiresReview===true)process.exitCode=1;break;}
 await new Promise(done=>setTimeout(done,5000));
}
