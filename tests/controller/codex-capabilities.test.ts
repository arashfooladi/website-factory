import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID,randomInt} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import type {AddressInfo} from 'node:net';
import {parseConfig} from '../../src/config.js';
import {CodexAdapter} from '../../src/codex-adapter.js';
import {AgentBrowser} from '../../src/agent-browser.js';
import {AgentArtifacts} from '../../src/agent-artifacts.js';

test('real Codex reads an initial screenshot and a screenshot returned by a dynamic browser tool',async()=>{
  const config=parseConfig({...JSON.parse(await readFile('.runtime/controller/config.test.json','utf8')),agentRoot:'.runtime/controller/codex-capability-tests'});
  const labels=['A'+randomInt(1000,9999)+'B','C'+randomInt(1000,9999)+'D'];
  const server=createServer((request,response)=>{
    response.setHeader('Content-Type','text/html');
    response.end(`<html><title>Visual probe</title><canvas width="1000" height="400"></canvas><script>const c=document.querySelector('canvas').getContext('2d');c.fillStyle='white';c.fillRect(0,0,1000,400);c.fillStyle='black';c.font='bold 100px monospace';c.fillText(${JSON.stringify(labels[request.url==='/second'?1:0])},50,160);</script></html>`);
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const runId=randomUUID();const store=new AgentArtifacts(config.agentRoot+'/images/'+runId,8388608);
  const browser=new AgentBrowser(`http://127.0.0.1:${(server.address()as AddressInfo).port}`,'probe',store,new AbortController().signal);
  try{
    await browser.open();const one=await browser.act({action:'navigate',path:'/'});const two=await browser.act({action:'navigate',path:'/second'});
    let toolCalls=0;
    const result=await new CodexAdapter(config).run({runId,sessionKey:randomUUID(),role:'analyst',instructions:'Transcribe the labels visible in supplied images. Use only the assigned tool.',instructionsHash:'capability-test-v1',skillVersions:{},
      prompt:'Read the label in the initial image. Call factory_picture to see a second image. Return only both visible labels, in order, separated by a space. The labels are not supplied in text.',
      images:[{dataUrl:await store.image(one.after.screenshot.id)}],limits:{maxRuntimeMs:180000,maxObservedTokens:30000,maxToolCalls:3,maxArtifactBytes:8388608},
      tools:[{name:'factory_picture',description:'Get the second screenshot.',inputSchema:{type:'object',properties:{},required:[],additionalProperties:false}}]},
    {signal:new AbortController().signal,onEvent:async()=>{},onTool:async name=>{assert.equal(name,'factory_picture');toolCalls++;return{success:true,contentItems:[{type:'inputImage',imageUrl:await store.image(two.after.screenshot.id)}]};}});
    assert.equal(result.status,'completed',result.errorCode??'Provider did not complete');assert.equal(toolCalls,1);
    assert.equal(result.text.trim(),labels.join(' '));assert(result.usage.confirmed);assert(result.usage.totalTokens>0);
    await mkdir('.runtime/controller',{recursive:true});await writeFile('.runtime/controller/codex-capability-evidence.json',JSON.stringify({runId,status:result.status,labelsMatched:true,toolCalls,usage:result.usage}),{mode:0o600});
  }finally{await browser.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});
