import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {Controller} from '../../src/controller.js';
import {Environments} from '../../src/environments.js';
import {Intakes} from '../../src/intakes.js';
import {Agents} from '../../src/agents.js';
import {AgentReference} from '../../src/agent-reference.js';
import {parseConfig} from '../../src/config.js';
import {createApi} from '../../src/api.js';
import {Themes,BASELINE_BUNDLE_ID} from '../../src/themes.js';

const exec=promisify(execFile),config=parseConfig({...JSON.parse(await readFile('.runtime/controller/config.test.json','utf8')),
  environmentRoot:'.runtime/controller/theme-environments',themeRoot:'.runtime/controller/theme-tests',referenceRoot:'.runtime/controller/theme-references',previewPortBase:9800});
let controller:Controller,environments:Environments,themes:Themes,intakes:Intakes,api:ReturnType<typeof createApi>,origin:string,projectId:string;
let goodId:string,badId:string,oldIntakeId:string,newIntakeId:string;const allocated:string[]=[];
const headers={Authorization:`Bearer ${config.apiToken}`};
async function waitTheme(id:string){const end=Date.now()+1200000;while(Date.now()<end){const row=await themes.inspect(config.ownerId,id);
  if(!['queued','certifying'].includes(row.status))return row;await new Promise(done=>setTimeout(done,500));}throw new Error('theme_test_timeout');}
async function settled(id:string,status:string){const end=Date.now()+660000;while(Date.now()<end){const row=await environments.inspect(config.ownerId,id);
  if(row.status==='failed')throw new Error('environment_test_failed');if(row.status===status&&!row.current_operation_id)return row;await new Promise(done=>setTimeout(done,300));}throw new Error('environment_test_timeout');}
async function intakeDone(id:string){const end=Date.now()+30000;while(Date.now()<end){const row=await intakes.inspect(config.ownerId,id);
  if(!['queued','running'].includes(row.status))return row;await new Promise(done=>setTimeout(done,200));}throw new Error('intake_test_timeout');}
async function archive(kind:string){
  const file=join(config.themeRoot,kind+'-'+randomUUID()+'.zip');
  await exec('python3',['-c',`import sys,zipfile\nfrom pathlib import Path\nroot=Path(sys.argv[1]);kind=sys.argv[3]\nwith zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED) as out:\n for path in sorted(root.rglob('*')):\n  if path.is_file():\n   data=path.read_bytes()\n   if path.name=='style.css' and path.parent==root:data=data.replace(b'Version: 0.4.0',b'Version: 0.4.1-test')+b'\\n/* Simulated compatible update for factory test only. */\\n'\n   if kind=='bad' and path.name=='functions.php' and path.parent==root:data+=b'\\nthis is invalid PHP !\\n'\n   out.writestr('maintheme/'+path.relative_to(root).as_posix(),data)`,resolve('baseline/source/maintheme'),file,kind]);
  return readFile(file);
}
before(async()=>{
  assert(new URL(config.databaseUrl).pathname.endsWith('_test'));controller=await new Controller(config).open();
  environments=await new Environments(controller).open();themes=await new Themes(controller,environments).open();intakes=await new Intakes(controller).open();
  api=createApi(controller,environments,undefined,intakes,themes);await new Promise<void>(done=>api.listen(0,'127.0.0.1',done));origin=`http://127.0.0.1:${(api.address()as AddressInfo).port}`;
  projectId=(await controller.createProject(config.ownerId,{name:'Versioned theme fixture'})).id;
  await mkdir(config.themeRoot,{recursive:true});
});
after(async()=>{
  if(themes){await themes.setDefault(config.ownerId,BASELINE_BUNDLE_ID);await themes.close();}
  if(intakes)await intakes.close();
  if(environments){
    for(const id of allocated){const row=await environments.inspect(config.ownerId,id).catch(()=>null);if(row&&row.status!=='deleted'){
      if(row.current_operation_id)await settled(id,row.status==='creating'?'stopped':'deleted').catch(()=>{});
      const current=await environments.inspect(config.ownerId,id);if(current.status!=='deleted'&&!current.current_operation_id){await environments.request(config.ownerId,id,'destroy');await settled(id,'deleted');}
    }}await environments.close();
  }
  if(api){api.closeAllConnections();await new Promise<void>(done=>api.close(()=>done()));}if(controller)await controller.close();
});
test('imports are immutable and cannot become defaults or build inputs before compatibility certification',async()=>{
  const brief=await intakes.create(config.ownerId,{projectId,mode:'custom',prompt:'A small finished textile store with clear product navigation.'});oldIntakeId=brief.id;
  assert.equal((await intakeDone(oldIntakeId)).theme_bundle_id,BASELINE_BUNDLE_ID);
  const response=await fetch(origin+'/v1/theme-bundles',{method:'POST',headers:{...headers,'Content-Type':'application/zip','X-Factory-Base-Bundle':BASELINE_BUNDLE_ID},body:await archive('good')});
  assert.equal(response.status,201);goodId=(await response.json()as any).id;
  const imported=await themes.inspect(config.ownerId,goodId);assert.equal(imported.status,'imported');assert.equal(imported.manifest.versions.parent,'0.4.1-test');
  assert.notEqual(imported.source_digest,(await themes.inspect(config.ownerId,BASELINE_BUNDLE_ID)).source_digest);
  await assert.rejects(themes.setDefault(config.ownerId,goodId),/theme_bundle_not_certified/);
  await assert.rejects(environments.create(config.ownerId,{projectId,themeBundleId:goodId}),/theme_bundle_not_certified/);
  await assert.rejects(intakes.create(config.ownerId,{projectId,mode:'custom',themeBundleId:goodId,prompt:'Use this untested version.'}),/theme_bundle_not_certified/);
  await assert.rejects(themes.inspect(randomUUID(),goodId),/not_found/);
  assert.equal((await fetch(origin+'/v1/theme-bundles')).status,401);
});
test('a simulated MainTheme update passes real isolated responsive, product, admin and checkout checks',async()=>{
  const response=await fetch(origin+`/v1/theme-bundles/${goodId}/certify`,{method:'POST',headers});assert.equal(response.status,202);
  const row=await waitTheme(goodId);assert.equal(row.status,'certified',JSON.stringify({reason:row.reason,checks:row.report?.checks}));
  assert.equal(row.report.checks.filter((item:any)=>item.key==='responsive-route').length,9);
  for(const key of ['static-contract','theme-plugin-product-runtime','variable-and-unavailable-products','controlled-persian-checkout','wordpress-product-administration','wordpress-debug-log'])assert(row.report.checks.some((item:any)=>item.key===key&&item.status==='passed'),key);
  const artifact=row.report.artifacts.find((item:any)=>item.mediaType==='image/png');assert(artifact);
  assert((await themes.artifact(config.ownerId,goodId,artifact.id)).bytes.length>1000);
  await settled(row.environment_id,'deleted');
});
test('changing the default affects new briefs while revisions and old environments remain pinned',async()=>{
  await themes.setDefault(config.ownerId,goodId);
  const old=await intakes.inspect(config.ownerId,oldIntakeId);assert.equal(old.theme_bundle_id,BASELINE_BUNDLE_ID);
  const revision=await intakes.revise(config.ownerId,oldIntakeId,{design:{density:'compact'}});assert.equal((await intakeDone(revision.id)).theme_bundle_id,BASELINE_BUNDLE_ID);
  const unchanged=(await intakes.create(config.ownerId,{projectId,mode:'custom',prompt:'A new brief in the existing project keeps its project theme.'})).id;
  assert.equal((await intakeDone(unchanged)).theme_bundle_id,BASELINE_BUNDLE_ID);
  newIntakeId=(await intakes.create(config.ownerId,{projectId,themeBundleId:goodId,mode:'custom',prompt:'Explicitly test an updated theme candidate in this project.'})).id;
  assert.equal((await intakeDone(newIntakeId)).theme_bundle_id,goodId);
  const oldEnvironment=await environments.create(config.ownerId,{projectId,themeBundleId:BASELINE_BUNDLE_ID});allocated.push(oldEnvironment.id);await settled(oldEnvironment.id,'stopped');
  const newProject=(await controller.createProject(config.ownerId,{name:'New client uses the newly selected default'})).id;
  const updatedEnvironment=await environments.create(config.ownerId,{projectId:newProject});allocated.push(updatedEnvironment.id);await settled(updatedEnvironment.id,'stopped');
  for(const [id,bundle,version]of [[oldEnvironment.id,BASELINE_BUNDLE_ID,'0.4.0'],[updatedEnvironment.id,goodId,'0.4.1-test']]){
    const data=JSON.parse(await readFile(join(config.environmentRoot,'instances',id!,'private.json'),'utf8'));assert.equal(data.themeBundle.id,bundle);
    const style=await readFile(join(data.cache,'maintheme/style.css'),'utf8');assert(style.includes('Version: '+version));
  }
  await environments.request(config.ownerId,oldEnvironment.id,'start');await settled(oldEnvironment.id,'running');
  const agents=new Agents(controller,environments);await assert.rejects(agents.create(config.ownerId,{environmentId:oldEnvironment.id,intakeId:newIntakeId,prompt:'Mismatched theme must not run.'}),/theme_bundle_intake_mismatch/);
  const reference=await new AgentReference(controller,projectId,newIntakeId).open();assert.equal(reference.overview().themeBundle.versions.parent,'0.4.1-test');
  const contract=await reference.invoke({action:'theme',document:'docs/CHILD-THEMES.md'});assert.equal(contract.success,true);
  await assert.rejects(themes.setProjectDefault(randomUUID(),projectId,goodId),/not_found/);
  await themes.setProjectDefault(config.ownerId,projectId,goodId);
  const migrated=await intakes.create(config.ownerId,{projectId,mode:'custom',prompt:'Future briefs use the explicitly updated project theme.'});
  assert.equal((await intakeDone(migrated.id)).theme_bundle_id,goodId);
  assert.equal((await intakes.inspect(config.ownerId,oldIntakeId)).theme_bundle_id,BASELINE_BUNDLE_ID);
  assert.equal((await environments.inspect(config.ownerId,oldEnvironment.id)).theme_bundle_id,BASELINE_BUNDLE_ID);
});
test('a broken update fails static certification and never changes the selected default',async()=>{
  badId=(await themes.importFile(config.ownerId,await archive('bad'),BASELINE_BUNDLE_ID)).id;
  await themes.certify(config.ownerId,badId);const row=await waitTheme(badId);assert.equal(row.status,'needs_review');assert.equal(row.reason,'theme_static_checks_failed');
  assert.equal(row.environment_id,null);await assert.rejects(themes.setDefault(config.ownerId,badId),/theme_bundle_not_certified/);
  assert.equal((await themes.list(config.ownerId)).defaultBundleId,goodId);
  const original=await themes.verified(BASELINE_BUNDLE_ID);assert.equal(original.versions.parent,'0.4.0');
});
