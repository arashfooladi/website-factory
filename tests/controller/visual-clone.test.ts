import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {Controller} from '../../src/controller.js';
import {Environments} from '../../src/environments.js';
import {AgentWorkspace} from '../../src/agent-workspace.js';
import {parseConfig} from '../../src/config.js';

test('visual clone isolates real WordPress data, media, credentials and read-only candidate source',async()=>{
 const config=parseConfig({...JSON.parse(await readFile('.runtime/controller/config.test.json','utf8')),environmentRoot:resolve('.runtime/controller/visual-clone-tests'),previewPortBase:9540,maxEnvironments:4});
 assert(new URL(config.databaseUrl).pathname.endsWith('_test'));
 const controller=await new Controller(config).open(),manager=await new Environments(controller).open(),ids:string[]=[];
 const settle=async(id:string,status:string)=>{
  const until=Date.now()+600000;
  while(Date.now()<until){const state=await manager.inspect(config.ownerId,id);if(state.status==='failed')throw new Error('clone_fixture_lifecycle_failed');if(state.status===status&&!state.current_operation_id)return state;await new Promise(done=>setTimeout(done,300));}
  throw new Error('clone_fixture_lifecycle_timeout');
 };
 const wp=async(id:string,code:string)=>(await manager.runtime('exec',id,['/tools/php','/tools/wp-cli.phar','--path=/site','eval',code])).stdout.trim();
 try{
  const project=await controller.createProject(config.ownerId,{name:'Visual clone proof'});
  for(let i=0;i<2;i++){const created=await manager.create(config.ownerId,{projectId:project.id});ids.push(created.id);await settle(created.id,'stopped');}
  const [source,target]=ids as[string,string];await manager.request(config.ownerId,source,'start');const original=await settle(source,'running');
  await wp(source,`update_option('clone_marker','original');update_option('clone_serialized',array('url'=>home_url('/shop/')));`);
  await writeFile(join(config.environmentRoot,'instances',source,'uploads','proof.txt'),'original artwork');
  const workspace=new AgentWorkspace(manager,source);await workspace.edit({path:'child/clone-marker.txt',content:'candidate source'});
  const digest=(await workspace.export()).sha256;
  await assert.rejects(manager.runtime('clone-visual',target,[],{sourceEnvironmentId:source,sourceDigest:'f'.repeat(64)}));
  const provenance=await manager.runtime('clone-visual',target,[],{sourceEnvironmentId:source,sourceDigest:digest});
  assert.equal(provenance.sourceDigest,digest);assert.match(provenance.databaseDumpSha256,/^[a-f0-9]{64}$/);
  await manager.request(config.ownerId,target,'start');const cloned=await settle(target,'running');
  assert.equal((await new AgentWorkspace(manager,target).export()).sha256,digest);
  assert.equal(await wp(target,'echo get_option("clone_marker");'),'original');assert.equal(await wp(target,'echo get_option("factory_environment_id");'),target);
  assert.equal(await wp(target,'echo get_option("clone_serialized")["url"];'),`http://127.0.0.1:${cloned.preview_port}/shop/`);
  assert.equal(await wp(source,'echo get_option("clone_serialized")["url"];'),`http://127.0.0.1:${original.preview_port}/shop/`);
  await wp(target,'update_option("clone_marker","qa change");');assert.equal(await wp(source,'echo get_option("clone_marker");'),'original');
  await assert.rejects(new AgentWorkspace(manager,target).edit({path:'child/clone-marker.txt',content:'changed'}));
  const permissions=await manager.runtime('exec',target,['/usr/bin/python3','-c','from pathlib import Path\ntry:\n Path("/site/wp-content/uploads/proof.txt").write_text("changed")\n print("writable")\nexcept OSError:\n print("readonly")']);assert.equal(permissions.stdout.trim(),'readonly');
  assert.equal(await readFile(join(config.environmentRoot,'instances',source,'uploads','proof.txt'),'utf8'),'original artwork');
  assert.notEqual((await manager.credentials(config.ownerId,source)).password,(await manager.credentials(config.ownerId,target)).password);
  const secret=JSON.parse(await readFile(join(config.environmentRoot,'instances',target,'private.json'),'utf8'));
  const response=await fetch(`http://127.0.0.1:${cloned.preview_port}/`,{headers:{Authorization:`Bearer ${secret.previewToken}`}});assert.equal(response.status,200);
  await assert.rejects(manager.runtime('clone-visual',target,[],{sourceEnvironmentId:source,sourceDigest:digest}));
 }finally{
  for(const id of ids){const state=await manager.inspect(config.ownerId,id).catch(()=>null);if(state&&state.status!=='deleted'&&!state.current_operation_id){await manager.request(config.ownerId,id,'destroy');await settle(id,'deleted');}}
  await manager.close();await controller.close();
 }
});
