// Explicit native-provider pilot. Not part of npm test; it uses the configured
// Codex account and records observed tokens, with monetary cost left unknown.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from '@playwright/test';
import {loadConfig} from '../src/config.js';
import {IntakeInput} from '../src/intake-contracts.js';
import {BuildInput} from '../src/build-contracts.js';
import {parseArgs} from 'node:util';

const {values:options}=parseArgs({options:{retry:{type:'boolean',default:false}}});

const config=await loadConfig(),root=resolve('.runtime/controller/part-7-pilot');
await mkdir(root,{recursive:true,mode:0o700});
const fixture=JSON.parse(await readFile('fixtures/part-7-pilot.json','utf8'));
// Check fixtures before creating a project, uploading assets or using a provider.
IntakeInput.parse({...fixture.brief,projectId:randomUUID()});
BuildInput.parse({intakeId:randomUUID(),content:fixture.content,agentLimits:fixture.agentLimits,maxObservedTokens:2000000,maxRuntimeMs:3600000});
const origin=`http://${config.host==='::1'?'[::1]':config.host}:${config.port}`;
const stateFile=join(root,'state.json');
async function api(path:string,body?:unknown){
  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${config.apiToken}`,'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
  const value=await response.json()as any;if(!response.ok)throw new Error(`pilot_api_${response.status}: ${value.error??'request_failed'}`);return value;
}
async function save(state:unknown){await writeFile(stateFile,JSON.stringify(state,null,2)+'\n',{mode:0o600});}
async function artwork(){
  const font=(await readFile('baseline/source/maintheme/assets/fonts/vazirmatn.woff2')).toString('base64');
  const browser=await chromium.launch({executablePath:resolve('tools/browser-sandbox'),timeout:60000,env:{PATH:'/usr/bin',
    XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR??`/run/user/${process.getuid!()}`,
    ...(process.env.DBUS_SESSION_BUS_ADDRESS?{DBUS_SESSION_BUS_ADDRESS:process.env.DBUS_SESSION_BUS_ADDRESS}:{}),FACTORY_BROWSER_RUN:randomUUID()}});
  try{
    const page=await browser.newPage({viewport:{width:900,height:1200},deviceScaleFactor:1});
    const files:string[]=[];
    for(const [key,word,color,index]of [['aghaz','آغاز','#9e3d25','۰۱'],['aram','آرام','#293b4b','۰۲']]){
      await page.setContent(`<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><style>
        @font-face{font-family:Vazirmatn;src:url(data:font/woff2;base64,${font})}*{box-sizing:border-box}body{margin:0;background:#ede7d9;color:${color};font-family:Vazirmatn,sans-serif}
        main{height:1200px;padding:64px;display:flex;flex-direction:column;position:relative}header,footer{display:flex;justify-content:space-between;font-size:23px;font-weight:400}
        header{border-bottom:2px solid currentColor;padding-bottom:24px}h1{font-weight:600;font-size:270px;line-height:1.5;margin:auto 0;text-align:center;letter-spacing:0}
        .rule{height:12px;background:currentColor;width:${key==='aghaz'?'32':'64'}%;margin-bottom:48px;align-self:${key==='aghaz'?'flex-start':'flex-end'}}
        footer{border-top:2px solid currentColor;padding-top:24px}small{font-size:18px}</style>
        <main><header><span>سطر</span><span>${index}</span></header><h1>${word}</h1><div class="rule"></div><footer><span>چاپ تایپوگرافیک فارسی</span><small dir="ltr">SATR / ${key!.toUpperCase()}</small></footer></main></html>`);
      await page.evaluate(()=>document.fonts.ready);const file=join(root,key+'.png');await page.screenshot({path:file});files.push(file);
    }
    return files;
  }finally{await browser.close();}
}

let state:any=await readFile(stateFile,'utf8').then(JSON.parse).catch((error:any)=>{if(error.code!=='ENOENT')throw error;return null;});
if(!state){
  const project=await api('/v1/projects',{name:fixture.projectName});state={projectId:project.id,assetIds:[],createdAt:new Date().toISOString()};await save(state);
}
if(!state.intakeId){
  if(state.assetIds.length<2){
    const files=await artwork();
    for(const file of files.slice(state.assetIds.length)){
      const response=await fetch(origin+`/v1/projects/${state.projectId}/assets`,{method:'POST',headers:{Authorization:`Bearer ${config.apiToken}`,'Content-Type':'image/png',
        'X-Factory-Filename':encodeURIComponent(file.split('/').at(-1)!)},body:await readFile(file),signal:AbortSignal.timeout(20000)});
      const asset=await response.json()as any;if(!response.ok)throw new Error('pilot_asset_upload_failed');state.assetIds.push(asset.id);await save(state);
    }
  }
  if(state.assetIds.length!==2)throw new Error('pilot_assets_incomplete');
  const intake=await api('/v1/intakes',{...fixture.brief,projectId:state.projectId,assetIds:state.assetIds});state.intakeId=intake.id;await save(state);
}
let intake=await api('/v1/intakes/'+state.intakeId);
while(['queued','running'].includes(intake.status)){await new Promise(done=>setTimeout(done,1000));intake=await api('/v1/intakes/'+state.intakeId);}
if(intake.status!=='completed')throw new Error('pilot_intake_'+intake.status);
if(options.retry){
  if(!state.buildId||!state.designId)throw new Error('pilot_retry_requires_saved_build_and_design');
  const previous=await api('/v1/builds/'+state.buildId);
  if(!['cancelled','needs_review'].includes(previous.status))throw new Error('pilot_retry_requires_terminal_failure');
}
if(!state.buildId||options.retry){
  const content=structuredClone(fixture.content);content.heroAssetId=state.assetIds[0];
  content.products.forEach((product:any,index:number)=>product.imageAssetId=state.assetIds[index]);
  const build=await api('/v1/builds',{intakeId:state.intakeId,...(options.retry?{designId:state.designId}:{}),content,agentLimits:fixture.agentLimits,maxObservedTokens:2000000,maxRuntimeMs:3600000});
  if(state.buildId)state.previousBuildIds=[...new Set([...(state.previousBuildIds??[]),state.buildId])];
  state.buildId=build.id;await save(state);
}
let previous='';
for(;;){
  const row=await api('/v1/builds/'+state.buildId);state={...state,status:row.status,designId:row.design_id,environmentId:row.environment_id,
    designRunId:row.design_run_id,builderRunId:row.builder_run_id,candidateRevision:row.candidate_revision,observedTokens:row.observed_tokens,usageConfirmed:row.usage_confirmed,
    preview:row.preview,reason:row.reason};await save(state);
  const phase=[row.status,row.design_run_id,row.builder_run_id].join(':');
  if(phase!==previous){console.log(JSON.stringify({buildId:row.id,status:row.status,observedTokens:row.observed_tokens,reason:row.reason}));previous=phase;}
  if(['prototype_ready','needs_review','cancelled'].includes(row.status)){
    await writeFile(join(root,'build-evidence.json'),JSON.stringify(row,null,2)+'\n',{mode:0o600});
    if(row.status!=='prototype_ready')throw new Error('pilot_'+row.status+': '+row.reason);
    console.log(JSON.stringify({status:row.status,candidateRevision:row.candidate_revision,observedTokens:row.observed_tokens,usageConfirmed:row.usage_confirmed,releaseEligible:false}));break;
  }
  await new Promise(done=>setTimeout(done,5000));
}
