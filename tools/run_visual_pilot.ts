import {parseArgs} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {loadConfig} from '../src/config.js';

const {values}=parseArgs({options:{create:{type:'boolean'},candidate:{type:'string'}}});
const config=await loadConfig(),directory='.runtime/controller/part-8-pilot',filename=join(directory,'review-state.json');
const origin=`http://${config.host==='::1'?'[::1]':config.host}:${config.port}`;
async function api(path:string,body?:unknown){
 const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${config.apiToken}`,'Content-Type':'application/json'},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error(`Pilot API failed: HTTP ${response.status}`);
 return response.json()as Promise<any>;
}
await mkdir(directory,{recursive:true,mode:0o700});
let state:{reviewId:string;candidateRunId:string};
try{state=JSON.parse(await readFile(filename,'utf8'));}
catch(error){
 if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
 if(!values.create||!values.candidate)throw new Error('First run requires --create --candidate <completed-builder-run-uuid>; later runs resume the saved review.');
 const candidate=z.uuid().parse(values.candidate);
 const created=await api('/v1/visual-reviews',{candidateRunId:candidate,maxRuntimeMs:3600000,maxObservedTokens:800000});
 state={reviewId:created.id,candidateRunId:candidate};await writeFile(filename,JSON.stringify(state),{mode:0o600,flag:'wx'});
}
if(values.candidate&&state.candidateRunId!==values.candidate)throw new Error('Saved pilot belongs to another candidate; do not overwrite its evidence.');
let previous='';
for(;;){
 const row=await api('/v1/visual-reviews/'+state.reviewId);
 const started=row.events.filter((event:any)=>event.type==='task_started'),finished=row.events.filter((event:any)=>event.type==='task_finished');
 const summary={reviewId:row.id,status:row.status,reason:row.reason,qaEnvironmentId:row.qa_environment_id,completedRoutes:finished.length,
  activeRoute:started.length>finished.length?started.at(-1)?.data.path:null,observedTokens:row.usage?.totalTokens??null,usageConfirmed:row.usage?.confirmed??null,
  ...(row.report?{requiresRepair:row.report.requiresRepair,coverageComplete:row.report.coverageComplete,visualReferenceComparisonComplete:row.report.visualReferenceComparisonComplete}:{} )};
 const serialized=JSON.stringify(summary);if(serialized!==previous){console.log(serialized);previous=serialized;}
 if(!['queued','running','cancelling'].includes(row.status)){
  await writeFile(join(directory,'review-result.json'),JSON.stringify(row),{mode:0o600});
  if(row.status!=='reviewed')process.exitCode=1;
  break;
 }
 await new Promise(done=>setTimeout(done,5000));
}
