import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import type {IncomingMessage} from 'node:http';
import {Controller} from '../../src/controller.js';
import {parseConfig} from '../../src/config.js';
import {Environments} from '../../src/environments.js';
import {BuildRuntime} from '../../src/build-runtime.js';
import {BuildInput} from '../../src/build-contracts.js';
import {ProjectAssets} from '../../src/project-assets.js';
import {AgentArtifacts} from '../../src/agent-artifacts.js';
import {AgentBrowser} from '../../src/agent-browser.js';

const config=parseConfig({...JSON.parse(await readFile('.runtime/controller/config.test.json','utf8')),environmentRoot:'.runtime/controller/build-runtime-environments',previewPortBase:9900});
let controller:Controller,environments:Environments,runtime:BuildRuntime,environmentId:string,projectId:string,asset:any,manifest:any;
const buildId=randomUUID(),input=BuildInput.parse({intakeId:randomUUID(),content:{siteTitle:'Client runtime fixture',synthetic:true,currency:'USD',
  pages:[{path:'/',title:'Home',kind:'home',content:'<p>Client supplied demonstration content.</p>'},{path:'/shop/',title:'Shop',kind:'shop'},
    {path:'/cart/',title:'Cart',kind:'cart'},{path:'/checkout/',title:'Checkout',kind:'checkout'},{path:'/account/',title:'Account',kind:'account'},
    {path:'/about/materials/',title:'Materials',kind:'content',content:'<p>Supplied linen material note.</p>'}],
  products:[{key:'linen-towel',name:'Linen towel',description:'Illustrative product for a local test.',price:'18.50',stock:7},
    {key:'cushion-cover',name:'Cushion cover',price:'28.00',stock:3,variations:{attribute:'Size',options:['Small','Large']}}]}});
async function settled(status:string){const end=Date.now()+660000;while(Date.now()<end){const row=await environments.inspect(config.ownerId,environmentId);
  if(row.status==='failed')throw new Error('build_runtime_environment_failed');if(row.status===status&&!row.current_operation_id)return row;await new Promise(done=>setTimeout(done,300));}throw new Error('build_runtime_environment_timeout');}
const wp=async(code:string)=>JSON.parse((await environments.runtime('exec',environmentId,['/tools/php','/tools/wp-cli.phar','--path=/site','eval',code])).stdout.trim());
before(async()=>{
  assert(new URL(config.databaseUrl).pathname.endsWith('_test'));controller=await new Controller(config).open();environments=await new Environments(controller).open();runtime=new BuildRuntime(controller,environments);
  projectId=(await controller.createProject(config.ownerId,{name:'Prepared client content fixture'})).id;
  environmentId=(await environments.create(config.ownerId,{projectId})).id;await settled('stopped');await environments.request(config.ownerId,environmentId,'start');await settled('running');
});
after(async()=>{if(environments){if(environmentId){const row=await environments.inspect(config.ownerId,environmentId);if(row.status!=='deleted'&&!row.current_operation_id){await environments.request(config.ownerId,environmentId,'destroy');await settled('deleted');}}await environments.close();}if(controller)await controller.close();});
test('the isolated WordPress preview executes its actual scripts without page errors',async()=>{
  const state=await settled('running'),secret=JSON.parse(await readFile(join(config.environmentRoot,'instances',environmentId,'private.json'),'utf8'));
  const artifacts=new AgentArtifacts('.runtime/controller/build-runtime-script-debug',16000000),browser=new AgentBrowser(`http://127.0.0.1:${state.preview_port}`,secret.previewToken,artifacts,new AbortController().signal);
  const errors:string[]=[];try{await browser.open();await browser.protectedPage(async page=>{page.on('pageerror',error=>errors.push(error.stack??error.message));
    await page.goto(browser.origin+'/',{waitUntil:'networkidle'});await browser.capture();});}
  finally{await browser.close();await writeFile('.runtime/controller/build-runtime-script-errors.json',JSON.stringify(errors,null,2),{mode:0o600});}
  assert.deepEqual(errors,[]);
});
test('trusted setup creates real client pages, nested content and WooCommerce products without losing administration',async()=>{
  manifest=await runtime.prepare(buildId,environmentId,input,'en');assert.equal(manifest.products.length,2);assert.equal(manifest.pages.length,6);assert(manifest.adminPreserved);
  const state=await wp(`$m=get_option('factory_build_manifest');echo wp_json_encode(array('title'=>get_option('blogname'),'locale'=>get_option('WPLANG'),
    'resolvedLocale'=>get_locale(),'currency'=>get_option('woocommerce_currency'),'pages'=>count(get_posts(array('post_type'=>'page','numberposts'=>-1))),
    'products'=>count(get_posts(array('post_type'=>'product','numberposts'=>-1))),'admin'=>user_can(get_user_by('login','client_admin'),'manage_woocommerce'),
    'nested'=>get_page_by_path('about/materials')->post_content,'types'=>array_map(fn($p)=>wc_get_product($p['id'])->get_type(),$m['products'])));`);
  assert.equal(state.title,input.content.siteTitle);assert.equal(state.locale,'');assert.equal(state.resolvedLocale,'en_US');assert.equal(state.currency,'USD');assert.equal(state.products,2);assert(state.admin);assert(state.nested.includes('Supplied linen'));assert.deepEqual(state.types,['simple','variable']);
  const repeat=await runtime.prepare(buildId,environmentId,input,'en');assert.deepEqual(repeat,manifest);
  await assert.rejects(runtime.prepare(randomUUID(),environmentId,input,'en'));
  await assert.rejects(runtime.prepare(buildId,environmentId,{...input,content:{...input.content,siteTitle:'Unexpected mutation'}},'en'));
});
test('client raster imports are content-verified, attached to real products and idempotent',async()=>{
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNkoAAAAASUVORK5CYII=','base64');
  const request=Readable.from([bytes])as unknown as IncomingMessage;request.headers={'content-type':'image/png','x-factory-filename':'fixture.png'};
  asset=await new ProjectAssets(controller).upload(config.ownerId,projectId,request);
  const metadata=(await runtime.assets(projectId,{...input.content,heroAssetId:asset.id}))[0];
  const first=await runtime.importAsset(buildId,environmentId,metadata),repeat=await runtime.importAsset(buildId,environmentId,metadata);
  assert.equal(repeat.attachmentId,first.attachmentId);assert.equal(repeat.path,first.path);assert(first.path.includes('/uploads/factory/'+buildId+'/'));
  assert.equal((await runtime.manifest(environmentId)).assets[asset.id].attachmentId,first.attachmentId);
  const filename=join(config.referenceRoot,'assets',asset.id);
  try{await writeFile(filename,'corrupted');await assert.rejects(runtime.importAsset(buildId,environmentId,metadata),/build_asset_hash_mismatch/);}finally{await writeFile(filename,bytes);}
  await assert.rejects(runtime.assets(randomUUID(),{...input.content,heroAssetId:asset.id}),/build_client_asset_unavailable/);
});
