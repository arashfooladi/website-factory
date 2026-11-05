import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentArtifacts} from '../../src/agent-artifacts.js';
import {AgentBrowser} from '../../src/agent-browser.js';

for(const engine of ['firefox','webkit']as const)test(`${engine} isolated proxy preserves redirects, Persian posts, cookies and paired evidence while denying other origins`,async()=>{
 let foreign=0,seen='';const trap=createServer((_req,res)=>{foreign++;res.end('private');});await new Promise<void>(done=>trap.listen(0,'127.0.0.1',done));
 const trapOrigin=`http://127.0.0.1:${(trap.address()as AddressInfo).port}`;
 const server=createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer engine-test');const url=new URL(req.url!,'http://fixture');
  if(url.pathname==='/redirect'){res.writeHead(302,{Location:'/form','Set-Cookie':'proof=1; SameSite=Lax; Path=/'});res.end();return;}
  if(url.pathname==='/post'){
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));seen=Buffer.concat(chunks).toString();assert.match(req.headers.cookie??'',/proof=1/);
   res.writeHead(303,{Location:'/done'});res.end();return;
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html lang="fa" dir="rtl"><title>آزمایش</title><main>${url.pathname==='/done'?'ثبت شد':`<form method="post" action="/post"><label>نام<input name="name"></label><button>Submit</button></form>`}<img src="${trapOrigin}/private"><a id="foreign" href="${trapOrigin}/private">Other</a></main></html>`);
 });await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const root=await mkdtemp(join(tmpdir(),'factory-engines-')),origin=`http://127.0.0.1:${(server.address()as AddressInfo).port}`,browser=new AgentBrowser(origin,'engine-test',new AgentArtifacts(root,33554432),AbortSignal.timeout(120000),undefined,engine);
 try{
  await browser.open();await browser.protectedPage(async page=>{
   await page.goto(origin+'/redirect',{waitUntil:'load'});assert.equal(new URL(page.url()).pathname,'/form');await page.locator('input').fill('آزمایش فارسی');
   await page.locator('button').click();await page.waitForURL(origin+'/done');assert.equal(await page.locator('main').innerText(),'ثبت شدOther');
  });
  const evidence=await browser.capture();assert.equal(evidence.path,'/done');assert(evidence.html&&evidence.structure&&evidence.screenshot);assert.equal(new URLSearchParams(seen).get('name'),'آزمایش فارسی');assert.equal(foreign,0);
 }finally{await browser.close();server.closeAllConnections();trap.closeAllConnections();await Promise.all([new Promise<void>(done=>server.close(()=>done())),new Promise<void>(done=>trap.close(()=>done()))]);await rm(root,{recursive:true,force:true});}
});

test('firefox preserves successive AJAX form bodies after a validation failure',async()=>{
 const submissions:Array<Record<string,string>>=[];
 const server=createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer engine-test');
  if(req.url==='/checkout'){
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const values=Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()));submissions.push(values);
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result:values.name?'success':'failure'}));return;
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html lang="fa"><main><form><input name="nonce" type="hidden" value="fixture-nonce"><label>نام<input id="name" name="name"></label><button>ثبت</button></form><p id="result"></p></main><script>document.querySelector('form').onsubmit=function(event){event.preventDefault();const xhr=new XMLHttpRequest();xhr.open('POST','/checkout');xhr.setRequestHeader('Content-Type','application/x-www-form-urlencoded; charset=UTF-8');xhr.onload=()=>document.querySelector('#result').textContent=JSON.parse(xhr.responseText).result;xhr.send(new URLSearchParams(new FormData(this)).toString());};</script></html>`);
 });await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const root=await mkdtemp(join(tmpdir(),'factory-firefox-xhr-')),origin=`http://127.0.0.1:${(server.address()as AddressInfo).port}`,browser=new AgentBrowser(origin,'engine-test',new AgentArtifacts(root,33554432),AbortSignal.timeout(120000),undefined,'firefox');
 try{
  await browser.open();await browser.protectedPage(async page=>{
   await page.goto(origin,{waitUntil:'load'});await page.locator('button').click();await page.locator('#result').filter({hasText:'failure'}).waitFor();
   await page.locator('#name').fill('نام فارسی');await page.locator('button').click();await page.locator('#result').filter({hasText:'success'}).waitFor();
  });assert.deepEqual(submissions,[{nonce:'fixture-nonce',name:''},{nonce:'fixture-nonce',name:'نام فارسی'}]);await browser.capture();
 }finally{await browser.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(root,{recursive:true,force:true});}
});
