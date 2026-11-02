import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import {Controller} from '../../src/controller.js';
import {parseConfig} from '../../src/config.js';
import {Intakes} from '../../src/intakes.js';
import {createApi} from '../../src/api.js';
import {PublicReferenceNetwork} from '../../src/reference-network.js';
import {canonicalJson,sha256} from '../../src/immutable.js';
import {AgentReference} from '../../src/agent-reference.js';
import {Agents} from '../../src/agents.js';
import {BASELINE_BUNDLE_ID} from '../../src/themes.js';
import {Environments} from '../../src/environments.js';
import {EnvironmentLimits} from '../../src/environment-contracts.js';

const config=parseConfig({...JSON.parse(await readFile('.runtime/controller/config.test.json','utf8')),referenceRoot:'.runtime/controller/reference-tests'});
let controller:Controller,intakes:Intakes,api:ReturnType<typeof createApi>,origin:string,projectId:string,assetId:string,complete:any;
const headers={authorization:`Bearer ${config.apiToken}`,'content-type':'application/json'};
const base='https://reference.factory.test';
let heldStarted!:()=>void;let held=new Promise<void>(done=>{heldStarted=done;});
const networks:PublicReferenceNetwork[]=[];
const networkFactory=(signal:AbortSignal)=>{
  const network=new PublicReferenceNetwork(signal,undefined,{resolve:async hostname=>[{address:hostname==='private.factory.test'?'10.0.0.1':'93.184.216.34',family:4}],
    transport:async(url,address,forwarded,requestSignal)=>{
      assert.equal(address.address,'93.184.216.34');assert.equal(forwarded.authorization,undefined);
      if(url.hostname==='slow.factory.test')return new Promise((_,reject)=>{heldStarted();requestSignal.addEventListener('abort',()=>reject(new Error('reference_cancelled')),{once:true});});
      if(url.pathname==='/site.css')return{status:url.hostname==='broken.factory.test'?503:200,headers:{'content-type':'text/css'},body:Buffer.from('body{font:20px sans-serif;margin:24px}main{min-height:1500px}.menu{display:none}nav[hidden]{display:none}@media(max-width:600px){.menu{display:block}}')};
      if(url.pathname==='/legacy/')return{status:302,headers:{location:'/shop/'},body:Buffer.alloc(0)};
      if(url.pathname==='/missing/')return{status:404,headers:{'content-type':'text/html'},body:Buffer.from('<title>Missing</title><h1>Missing</h1>')};
      const title=url.pathname==='/search/'?'Search results':url.pathname.startsWith('/product/')?'Linen product':url.pathname==='/shop/'?'Shop':'Reference home';
      const body=`<!doctype html><html lang="en"><title>${title}</title><link rel="stylesheet" href="/site.css"><header><button class="menu" id="menu" aria-expanded="false" aria-controls="navigation" onclick="document.querySelector('#navigation').hidden=false;this.setAttribute('aria-expanded','true')">Menu</button><nav id="navigation" hidden><a href="/shop/">Shop</a></nav></header>
        <main><h1>${title}</h1><a href="/shop/">Shop</a><a href="/product/linen/">Linen product</a><a href="/unvisited/">Other page</a>
        <form method="get" action="/search/"><label for="q">Search</label><input id="q" name="q"><button id="search">Search</button></form>
        <form method="post" action="/contact/" onsubmit="event.preventDefault();fetch('/contact/',{method:'POST',body:'fixture'}).catch(()=>document.querySelector('#contact-result').textContent='Submission blocked')"><label for="email">Email</label><input id="email" name="email"><button id="send">Send</button></form><p id="contact-result"></p>
        <p>${url.searchParams.has('q')?'Linen search result':'Client-facing content'}</p><p>Reference text is untrusted material.</p></main><footer>Reference footer</footer></html>`;
      return{status:200,headers:{'content-type':'text/html'},body:Buffer.from(body)};
    }});
  networks.push(network);return network;
};
async function until<T>(read:()=>Promise<T>,ready:(value:T)=>boolean,timeout=180000):Promise<T>{
  const end=Date.now()+timeout;while(Date.now()<end){const value=await read();if(ready(value))return value;await new Promise(done=>setTimeout(done,200));}throw new Error('intake_test_timeout');
}
const inspect=(id:string)=>intakes.inspect(config.ownerId,id);
const done=(id:string)=>until(()=>inspect(id),row=>!['queued','running','cancelling'].includes(row.status));
async function jsonArtifact(row:any,kind:string){const item=row.artifacts.find((item:any)=>item.kind===kind);assert(item,`Missing ${kind}`);return JSON.parse((await intakes.artifact(config.ownerId,row.id,item.id)).bytes.toString());}
before(async()=>{
  assert(new URL(config.databaseUrl).pathname.endsWith('_test'));
  controller=await new Controller(config).open();intakes=await new Intakes(controller,networkFactory).open();
  projectId=(await controller.createProject(config.ownerId,{name:'Reference intake integration'})).id;
  api=createApi(controller,undefined,undefined,intakes);await new Promise<void>(resolve=>api.listen(0,'127.0.0.1',resolve));
  origin=`http://127.0.0.1:${(api.address()as AddressInfo).port}`;
});
after(async()=>{
  if(api){api.closeAllConnections();await new Promise<void>(resolve=>api.close(()=>resolve()));}
  if(intakes)await intakes.close();if(controller)await controller.close();
});
test('client assets upload with owned metadata, immutable hashes and attachment-only delivery',async()=>{
  const bytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>Client</text></svg>');
  const response=await fetch(`${origin}/v1/projects/${projectId}/assets`,{method:'POST',headers:{authorization:headers.authorization,'content-type':'image/svg+xml','x-factory-filename':encodeURIComponent('نشان.svg')},body:bytes});
  assert.equal(response.status,201);const asset=await response.json()as any;assetId=asset.id;
  assert.equal(asset.name,'نشان.svg');assert.equal(asset.sha256,sha256(bytes));
  const downloaded=await fetch(`${origin}/v1/projects/${projectId}/assets/${asset.id}`,{headers});
  assert.equal(downloaded.status,200);assert.match(downloaded.headers.get('content-disposition')!,/^attachment/);assert.match(downloaded.headers.get('content-security-policy')!,/default-src 'none'/);
  assert.equal(sha256(Buffer.from(await downloaded.arrayBuffer())),asset.sha256);
  const foreign=(await controller.createProject(randomUUID(),{name:'Foreign assets'})).id;
  assert.equal((await fetch(`${origin}/v1/projects/${foreign}/assets`,{method:'POST',headers:{authorization:headers.authorization,'content-type':'image/png','x-factory-filename':'x.png'},body:bytes})).status,404);
  assert.equal((await fetch(`${origin}/v1/projects/${projectId}/assets`,{method:'POST',headers:{authorization:headers.authorization,'content-type':'text/plain','x-factory-filename':'too-large.txt'},body:Buffer.alloc(16777217)})).status,413);
});
test('a brief produces desktop/mobile evidence, HTML/CSS, menu/search transitions and a protected versioned specification',async()=>{
  const response=await fetch(origin+'/v1/intakes',{method:'POST',headers,body:JSON.stringify({projectId,prompt:'A complete linen store in the client identity; use the reference layout.',mode:'inspiration',language:'en',assetIds:[assetId],referenceUrls:[base+'/'],
    pages:[{path:'/',label:'Home',referenceUrl:base+'/'},{path:'/shop/',label:'Shop',referenceUrl:base+'/shop/'}],capture:{maxPages:3,maxStates:80},
    journeys:[{key:'search',label:'Search products',referenceUrl:base+'/',steps:[{action:'fill',selector:'#q',value:'linen'},{action:'press',selector:'#q',key:'Enter'}]},
      {key:'contact',label:'Contact submission',referenceUrl:base+'/',steps:[{action:'fill',selector:'#email',value:'fixture@example.invalid'},{action:'click',selector:'#send'}]}]})});
  assert.equal(response.status,202);const queued=await response.json()as any;complete=await done(queued.id);
  assert.equal(complete.status,'completed',complete.reason);assert.equal(complete.releaseEligible,false);
  const inventory=await jsonArtifact(complete,'reference_inventory'),spec=await jsonArtifact(complete,'build_specification');
  assert.equal(inventory.coverage.completeRequiredCaptures,true);assert.equal(inventory.coverage.allDiscoveredFlowsTested,false);
  assert(inventory.routes.some((route:any)=>route.url===base+'/product/linen/'&&!route.explicit));
  assert(inventory.links.some((link:any)=>link.url===base+'/unvisited/'&&link.status==='unvisited'));
  assert(inventory.states.some((state:any)=>state.viewport.width===1280));assert(inventory.states.some((state:any)=>state.viewport.width===390));
  assert(inventory.states.some((state:any)=>state.purpose==='menu-result'&&state.summary.elements.some((element:any)=>element.tag==='nav')));
  assert(inventory.states.some((state:any)=>state.purpose==='scroll-lower'&&state.scroll.y>0));
  const ids=new Set(inventory.states.map((state:any)=>state.stateId));
  for(const edge of inventory.transitions){assert(ids.has(edge.afterStateId));if(edge.beforeStateId)assert(ids.has(edge.beforeStateId));assert.equal(edge.observed,true);}
  assert.equal(inventory.journeys.find((journey:any)=>journey.key==='search').status,'observed');
  assert.equal(inventory.journeys.find((journey:any)=>journey.key==='contact').status,'partial');
  assert.equal(inventory.journeys.find((journey:any)=>journey.key==='contact').reason,'reference_write_flow_unverified');
  const flowMap=await jsonArtifact(complete,'flow_map');assert(flowMap.observedTransitions.length>0);assert(flowMap.inferredLinks.every((item:any)=>item.observedTransition===false));
  assert(inventory.network.some((event:any)=>event.reason==='reference_write_request_denied'));
  assert(complete.artifacts.some((item:any)=>item.kind==='source_stylesheet'));assert(complete.artifacts.some((item:any)=>item.kind==='rendered_html'));
  assert.equal(spec.brief.direction,'ltr');assert.equal(spec.assets[0].id,assetId);assert.equal(spec.acceptance.baselineVersion,'wordpress-acceptance-v1');
  assert(spec.acceptance.requirements.some((item:any)=>item.id==='baseline:admin-products'&&item.required&&item.source==='protected-baseline'));
  assert(spec.assumptions.some((item:any)=>item.key==='journey:contact'));
  assert.equal(sha256(canonicalJson(spec.acceptance)),complete.acceptance_sha256);
  assert.equal((await readFile(join(config.referenceRoot,'intakes',complete.id,'specification','build-specification.json'),'utf8')),canonicalJson(spec));
  await writeFile('.runtime/controller/reference-integration-evidence.json',JSON.stringify({id:complete.id,revision:complete.revision,states:inventory.states.length,routes:inventory.routes.length,journeys:inventory.journeys,acceptanceHash:complete.acceptance_sha256}),{mode:0o600});
});
test('incomplete reference coverage is never labelled a completed specification',async()=>{
  const next=await intakes.create(config.ownerId,{projectId,prompt:'Capture all required references.',referenceUrls:[base+'/',base+'/shop/',base+'/missing/'],capture:{maxPages:3,maxStates:8,exploreMenus:false,captureScroll:false,discoverLinks:false}});
  const row=await done(next.id);assert.equal(row.status,'needs_review');assert.equal(row.reason,'required_reference_capture_incomplete');
  const inventory=await jsonArtifact(row,'reference_inventory');assert.equal(inventory.coverage.completeRequiredCaptures,false);assert(inventory.coverage.stateLimitReached||inventory.failures.length);
  assert(inventory.states.length<=8);assert.equal(row.revision,complete.revision+1);
});
test('URL validation, ownership and immutable artifact access reject unauthorized input',async()=>{
  assert.equal((await fetch(origin+'/v1/intakes',{method:'POST',headers,body:JSON.stringify({projectId,prompt:'invalid',referenceUrls:['http://127.0.0.1/']})})).status,400);
  assert.equal((await fetch(origin+'/v1/intakes',{method:'POST',headers,body:JSON.stringify({projectId,prompt:'private DNS',referenceUrls:['https://private.factory.test/']})})).status,400);
  assert.equal((await fetch(origin+'/v1/intakes/'+complete.id)).status,401);
  await assert.rejects(intakes.inspect(randomUUID(),complete.id),/not_found/);
  await assert.rejects(intakes.artifact(randomUUID(),complete.id,complete.artifacts[0].id),/not_found/);
  const other=(await controller.createProject(config.ownerId,{name:'Other asset ownership'})).id;
  await assert.rejects(intakes.create(config.ownerId,{projectId:other,prompt:'wrong asset',referenceUrls:[base+'/'],assetIds:[assetId]}),/asset_not_found/);
  const tooMany=await fetch(origin+'/v1/intakes',{method:'POST',headers,body:JSON.stringify({projectId,prompt:'bad capacity',referenceUrls:[base+'/',base+'/shop/'],capture:{maxPages:1}})});
  assert.equal(tooMany.status,400);
});
test('cancellation aborts a real isolated reference browser before publishing a specification',async()=>{
  held=new Promise<void>(done=>{heldStarted=done;});
  const next=await intakes.create(config.ownerId,{projectId,prompt:'Cancel this capture.',referenceUrls:['https://slow.factory.test/']});
  await held;await intakes.cancel(config.ownerId,next.id);const row=await done(next.id);
  assert.equal(row.status,'cancelled');assert.equal(row.spec_artifact_id,null);assert.equal(row.acceptance_sha256,null);
  assert(!row.artifacts.some((item:any)=>item.kind==='build_specification'));
});
test('lost styling and altered artifacts fail closed, and references remain bound to their project',async()=>{
  const next=await intakes.create(config.ownerId,{projectId,prompt:'Observe this page with a broken stylesheet.',referenceUrls:['https://broken.factory.test/'],capture:{maxPages:1,maxStates:8,discoverLinks:false,exploreMenus:false,captureScroll:false}});
  const row=await done(next.id);assert.equal(row.status,'needs_review');
  const inventory=await jsonArtifact(row,'reference_inventory');assert(inventory.failures.some((item:any)=>item.reason==='reference_styling_incomplete'));
  await assert.rejects(new AgentReference(controller,projectId,row.id).open(),/reference_specification_unavailable/);
  await assert.rejects(new AgentReference(controller,randomUUID(),complete.id).open(),/reference_specification_unavailable/);
  const artifact=row.artifacts.find((item:any)=>item.kind==='rendered_html');assert(artifact);
  const filename=join(config.referenceRoot,'intakes',row.id,'artifacts',artifact.id),original=await readFile(filename);
  try{await writeFile(filename,Buffer.concat([original,Buffer.from('altered')]));await assert.rejects(intakes.artifact(config.ownerId,row.id,artifact.id),/artifact_hash_mismatch/);}
  finally{await writeFile(filename,original);}
});
test('an expired capture lease stops its browser and rejects late specification publication',async()=>{
  held=new Promise<void>(done=>{heldStarted=done;});
  const next=await intakes.create(config.ownerId,{projectId,prompt:'Exercise recovery.',referenceUrls:['https://slow.factory.test/']});
  await held;
  await controller.pool.query("UPDATE factory.intakes SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[next.id]);
  await intakes.recover();const row=await done(next.id);
  assert.equal(row.status,'needs_review');assert.equal(row.reason,'capture_worker_interrupted');assert.equal(row.spec_artifact_id,null);
});
test('agent queue records preserve a completed reference revision and reject another project binding',async()=>{
  // This checks queue/SQL binding only; the native WordPress agent has its own live suite.
  const environmentId=randomUUID();
  await controller.pool.query("INSERT INTO factory.environments(id,project_id,status,limits,preview_port,theme_bundle_id) VALUES($1,$2,'running',$3,9980,$4)",[environmentId,projectId,EnvironmentLimits.parse({}),BASELINE_BUNDLE_ID]);
  await controller.boss.createQueue('factory-agent-v1');
  const agents=new Agents(controller,new Environments(controller));
  try{
    const run=await agents.create(config.ownerId,{environmentId,intakeId:complete.id,prompt:'Use the protected reference.'});
    assert.equal((await agents.inspect(config.ownerId,run.id)).intake_id,complete.id);await agents.cancel(config.ownerId,run.id);
    const next=await agents.resume(config.ownerId,run.id,{prompt:'Continue with the same reference.',limits:{}});
    assert.equal((await agents.inspect(config.ownerId,next.id)).intake_id,complete.id);await agents.cancel(config.ownerId,next.id);
    await assert.rejects(agents.create(config.ownerId,{environmentId,intakeId:randomUUID(),prompt:'Invalid reference.'}),/reference_specification_unavailable/);
  }finally{await controller.pool.query("UPDATE factory.environments SET status='deleted' WHERE id=$1",[environmentId]);}
});
test('custom direction works without a reference and editable preferences create a new immutable revision',async()=>{
  const options=await fetch(origin+'/v1/design-options',{headers}).then(response=>response.json())as any;
  assert.deepEqual(Object.keys(options.modes).sort(),['custom','inspiration','replica','semi-replica']);
  const custom=await intakes.create(config.ownerId,{projectId,prompt:'A client-specific custom catalog with clear navigation.',mode:'custom',referenceUrls:[],
    design:{instructions:'Use a compact product hierarchy.',fonts:['Vazirmatn'],palette:{accent:'#225544'},mustAvoid:['Generic icon tiles']}});
  const original=await done(custom.id);assert.equal(original.status,'completed');assert.equal(original.browser_id,null);
  const spec=await jsonArtifact(original,'build_specification');assert.equal(spec.reference.states.length,0);assert.equal(spec.designPolicy.mode,'custom');
  assert(spec.assumptions.some((item:any)=>item.key==='reference-not-provided'));
  const response=await fetch(origin+`/v1/intakes/${original.id}/revise`,{method:'POST',headers,body:JSON.stringify({design:{instructions:'Keep the new composition restrained.',axes:{layout:'adapt'}}})});
  assert.equal(response.status,202);const revised=await done(((await response.json())as any).id);
  assert.equal(revised.status,'completed');assert.equal(revised.revision,original.revision+1);
  assert.equal(revised.brief.design.fonts[0],'Vazirmatn');assert.equal(revised.brief.design.palette.accent,'#225544');assert.equal(revised.brief.design.axes.layout,'adapt');
  assert.equal((await inspect(original.id)).brief.design.instructions,'Use a compact product hierarchy.');
  assert.notEqual(revised.brief_sha256,original.brief_sha256);
  const reset=await done((await intakes.revise(config.ownerId,revised.id,{design:{palette:null,fonts:[],instructions:null}})).id);
  assert.equal(reset.status,'completed');assert.deepEqual(reset.brief.design.palette,{});assert.deepEqual(reset.brief.design.fonts,[]);assert.equal(reset.brief.design.instructions,'');
  assert.equal((await inspect(revised.id)).brief.design.palette.accent,'#225544');
  await assert.rejects(intakes.revise(config.ownerId,original.id,{projectId:randomUUID()}),/invalid_brief_patch/);
});

test('public reference redirects reach their validated destination and retain paired capture evidence',async()=>{
  const next=await intakes.create(config.ownerId,{projectId,prompt:'Understand the catalog reached through this old public link.',referenceUrls:[base+'/legacy/'],
    capture:{maxPages:1,maxStates:8,discoverLinks:false,exploreMenus:false,captureScroll:false}});
  const row=await done(next.id);assert.equal(row.status,'completed',row.reason);
  const inventory=await jsonArtifact(row,'reference_inventory');
  assert(inventory.network.some((event:any)=>event.url===base+'/legacy/'&&event.status===302));
  assert(inventory.network.some((event:any)=>event.url===base+'/shop/'&&event.status===200));
  for(const width of [1280,390]){
    const state=inventory.states.find((item:any)=>item.purpose==='route-initial'&&item.viewport.width===width);
    assert(state);assert.equal(state.title,'Shop');assert.equal(state.requestedUrl,base+'/legacy/');assert.equal(state.path,base+'/shop/');
    assert(state.screenshot.id);assert(state.html.id);assert(state.structure.id);
  }
});
