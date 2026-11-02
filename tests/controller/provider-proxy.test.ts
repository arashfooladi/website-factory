import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterTools,validateProviderEvents,prepareProviderRequest,ProviderProxy} from '../../src/provider-proxy.js';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {request} from 'node:http';

const allowed=new Set(['factory_read']);
test('provider tool catalog excludes native execution, external tools and unassigned functions',()=>{
  assert.deepEqual(filterTools([
    {type:'function',name:'exec_command'}, {type:'web_search'},
    {type:'function',name:'factory_read'},
    {type:'namespace',name:'functions',tools:[{type:'function',name:'factory_read'},{type:'function',name:'apply_patch'}]},
  ],allowed),[{type:'function',name:'factory_read'},{type:'namespace',name:'functions',tools:[{type:'function',name:'factory_read'}]}]);
});
test('Codex internal tool registries are replaced with the assigned direct functions',()=>{
  const result=prepareProviderRequest({input:[{type:'message',content:'task'},{type:'additional_tools',tools:[{name:'exec'}]}],tools:[{type:'custom',name:'exec'}]},allowed,
    [{name:'factory_read',description:'Read theme source.',inputSchema:{type:'object',properties:{},additionalProperties:false}}]);
  assert.deepEqual(result.input,[{type:'message',content:'task'}]);
  assert.equal(result.tools[0].name,'functions');assert(result.tools[0].description);
  assert.deepEqual(result.tools[0].tools.map((tool:any)=>tool.name),['factory_read']);
  assert.equal(result.stream,true);assert.equal(result.store,false);
});
test('proxy authenticates requests and accounts for a denied response before stopping it',async()=>{
  const root=await mkdtemp(join(tmpdir(),'factory-provider-'));
  let calls=0;let failure='';
  const proxy=await new ProviderProxy(root,'test-model',allowed,{maxRuntimeMs:1000,maxObservedTokens:1000,maxToolCalls:2,maxArtifactBytes:1048576},new AbortController().signal,
    async()=>{calls++;return[{type:'response.completed',response:{status:'completed',output:[{type:'custom_tool_call',name:'exec'}],usage:{input_tokens:20,output_tokens:5,total_tokens:25}}}];},code=>{failure=code;}).open();
  const send=(token:string)=>new Promise<number>((done,reject)=>{
    const req=request({socketPath:join(root,'provider.sock'),path:'/v1/responses',method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'}},response=>{response.resume();response.on('end',()=>done(response.statusCode!));});
    req.on('error',reject);req.end(JSON.stringify({model:'test-model',input:[]}));
  });
  try{
    assert.equal(await send('foreign'),401);assert.equal(calls,0);
    assert.equal(await send(proxy.token),502);assert.equal(calls,1);assert.equal(failure,'provider_tool_denied');
    assert.equal(proxy.usage.totalTokens,25);assert.equal(proxy.usage.confirmed,true);assert.equal(proxy.usage.costMicros,null);
  }finally{await proxy.close();await rm(root,{recursive:true,force:true});}
});
test('unapproved calls are rejected before any model response is replayed',()=>{
  const done={type:'response.completed',response:{status:'completed',output:[],usage:{total_tokens:10}}};
  assert.throws(()=>validateProviderEvents([{type:'response.output_item.added',item:{type:'function_call',name:'exec_command'}},done],allowed),/provider_tool_denied/);
  assert.throws(()=>validateProviderEvents([{type:'response.output_item.added',item:{type:'shell_call'}},done],allowed),/provider_tool_denied/);
  assert.throws(()=>validateProviderEvents([{...done,response:{...done.response,output:[{type:'function_call',name:'apply_patch'}]}}],allowed),/provider_tool_denied/);
  assert.throws(()=>validateProviderEvents([],allowed),/provider_response_incomplete/);
  assert.equal(validateProviderEvents([{type:'response.output_item.added',item:{type:'function_call',name:'factory_read'}},done],allowed).status,'completed');
});
test('closing the proxy aborts in-flight inference and preserves unknown usage',async()=>{
  const root=await mkdtemp(join(tmpdir(),'factory-inference-'));
  let started!:()=>void;let stopped=false;
  const ready=new Promise<void>(done=>{started=done;});
  const proxy=await new ProviderProxy(root,'test-model',allowed,{maxRuntimeMs:1000,maxObservedTokens:1000,maxToolCalls:2,maxArtifactBytes:1048576},new AbortController().signal,
    async(_,signal)=>new Promise((_,reject)=>{started();signal.addEventListener('abort',()=>{stopped=true;reject(new Error('agent_cancelled'));},{once:true});}),()=>{}).open();
  const pending=new Promise<void>(done=>{
    const req=request({socketPath:join(root,'provider.sock'),path:'/v1/responses',method:'POST',headers:{authorization:`Bearer ${proxy.token}`}},response=>{response.resume();response.on('end',done);});
    req.on('error',()=>done());req.end(JSON.stringify({model:'test-model',input:[]}));
  });
  try{
    await ready;assert.equal(proxy.usage.confirmed,false);
    await proxy.close();await pending;
    assert.equal(stopped,true);assert.equal(proxy.usage.confirmed,false);assert.equal(proxy.usage.costMicros,null);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('a reported token overrun is retained and blocks subsequent inference',async()=>{
  const root=await mkdtemp(join(tmpdir(),'factory-token-budget-'));let calls=0;
  const proxy=await new ProviderProxy(root,'test-model',allowed,{maxRuntimeMs:1000,maxObservedTokens:100,maxToolCalls:2,maxArtifactBytes:1048576},new AbortController().signal,
    async()=>{calls++;return[{type:'response.completed',response:{status:'completed',output:[],usage:{input_tokens:120,output_tokens:30,total_tokens:150}}}];},()=>{}).open();
  const send=()=>new Promise<number>((done,reject)=>{
    const req=request({socketPath:join(root,'provider.sock'),path:'/v1/responses',method:'POST',headers:{authorization:`Bearer ${proxy.token}`}},response=>{response.resume();response.on('end',()=>done(response.statusCode!));});
    req.on('error',reject);req.end(JSON.stringify({model:'test-model',input:[]}));
  });
  try{
    assert.equal(await send(),502);assert.equal(proxy.errorCode,'observed_token_budget_exceeded');
    assert.equal(proxy.usage.totalTokens,150);assert.equal(proxy.usage.confirmed,true);
    assert.equal(await send(),502);assert.equal(calls,1);
  }finally{await proxy.close();await rm(root,{recursive:true,force:true});}
});

test('provider HTTP failures retain a safe diagnostic without pretending usage is confirmed',async()=>{
  const root=await mkdtemp(join(tmpdir(),'factory-provider-http-'));let failure='';
  const proxy=await new ProviderProxy(root,'test-model',allowed,{maxRuntimeMs:1000,maxObservedTokens:1000,maxToolCalls:2,maxArtifactBytes:1048576},new AbortController().signal,
    async()=>{throw Object.assign(new Error('provider_http_failed'),{httpStatus:429,requestBody:'private prompt',credential:'never-log'});},code=>{failure=code;}).open();
  try{
    const status=await new Promise<number>((done,reject)=>{
      const req=request({socketPath:join(root,'provider.sock'),path:'/v1/responses',method:'POST',headers:{authorization:`Bearer ${proxy.token}`}},response=>{response.resume();response.on('end',()=>done(response.statusCode!));});
      req.on('error',reject);req.end(JSON.stringify({model:'test-model',input:[]}));
    });
    assert.equal(status,502);assert.equal(failure,'provider_http_failed');assert.equal(proxy.usage.confirmed,false);
    assert.deepEqual(JSON.parse(await readFile(join(root,'failure.json'),'utf8')),{code:'provider_http_failed',httpStatus:429});
  }finally{await proxy.close();await rm(root,{recursive:true,force:true});}
});
