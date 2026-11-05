import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentBrowser} from '../../src/agent-browser.js';
import {AgentArtifacts} from '../../src/agent-artifacts.js';

for(const engine of ['chromium','firefox'] as const)test(`${engine} protected receipt survives immediate checkout navigation`,async()=>{
 let posts=0;
 const server=createServer(async(req,res)=>{
  if(req.url==='/finish'&&req.method==='POST'){
   posts++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result:'success',message:'ثبت شد',redirect:'/done'}));return;
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(req.url==='/done'?'<main>Order received</main>':`<button>Submit</button><script>document.querySelector('button').onclick=async()=>{const result=await(await fetch('/finish',{method:'POST'})).json();location.href=result.redirect;};</script>`);
 });await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const root=await mkdtemp(join(tmpdir(),'factory-response-')),origin=`http://127.0.0.1:${(server.address()as AddressInfo).port}`,browser=new AgentBrowser(origin,'fixture',new AgentArtifacts(root,1048576),AbortSignal.timeout(60000),undefined,engine);
 try{
  await browser.open();await browser.protectedPage(async page=>{
   await page.goto(origin);
   const receipt=await browser.protectedNetworkResponse(response=>response.method==='POST'&&new URL(response.url).pathname==='/finish',()=>page.locator('button').click());
   await page.waitForURL(origin+'/done');assert.equal(receipt.status,200);assert.deepEqual(JSON.parse(receipt.body.toString()),{result:'success',message:'ثبت شد',redirect:'/done'});assert.equal(posts,1);
   await assert.rejects(browser.protectedNetworkResponse(()=>false,async()=>{},30),/browser_response_timeout/);
  });
 }finally{await browser.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(root,{recursive:true,force:true});}
});
