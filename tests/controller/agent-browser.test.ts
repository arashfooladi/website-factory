import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import {AgentBrowser} from '../../src/agent-browser.js';
import {AgentArtifacts} from '../../src/agent-artifacts.js';
import {createPreview} from '../../src/preview.js';

test('isolated browser records screenshots, HTML, layout and observed interaction transitions',async()=>{
  const root=await mkdtemp(join(tmpdir(),'factory-observation-'));
  let forbidden=0;
  const other=createServer((_,response)=>{forbidden++;response.end('forbidden');});
  await new Promise<void>(done=>other.listen(0,'127.0.0.1',done));
  const blocked=`http://127.0.0.1:${(other.address()as AddressInfo).port}`;
  const server=createServer((request,response)=>{
    assert.equal(request.headers.authorization,'Bearer fixture-preview');
    if(request.url==='/redirect'){response.writeHead(302,{Location:blocked});response.end();return;}
    response.setHeader('Content-Type','text/html');
    response.end(`<!doctype html><html lang="en"><title>Flow fixture</title><style>body{font:18px sans-serif;padding:24px}button{padding:12px}nav[hidden]{display:none}</style>
      <header><button id="menu" aria-expanded="false" onclick="document.querySelector('nav').hidden=false;this.setAttribute('aria-expanded','true')">Menu</button>
      <nav hidden><a href="/details">Details</a></nav></header><main><h1>Flow fixture</h1>
      <form onsubmit="event.preventDefault();document.querySelector('#result').textContent='Hello '+document.querySelector('#name').value"><input id="name" name="name"><button id="send">Send</button></form>
      <p id="result" role="status"></p><input type="password" value="never-capture-this">
      </main><script>fetch(${JSON.stringify(blocked)}).catch(()=>{});</script></html>`);
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const origin=`http://127.0.0.1:${(server.address()as AddressInfo).port}`;
  const store=new AgentArtifacts(root,16*1024*1024);
  const browser=new AgentBrowser(origin,'fixture-preview',store,new AbortController().signal);
  try{
    await browser.open();
    const initial=await browser.act({action:'navigate',path:'/'});
    assert.equal(initial.after.summary.httpStatus,200);
    assert(initial.after.screenshot.bytes>1000);
    assert((await store.image(initial.after.screenshot.id)).startsWith('data:image/png;base64,'));
    const source=await readFile(store.records.find(item=>item.id===initial.after.html.id)!.filename,'utf8');
    assert(source.includes('Flow fixture'));assert(!source.includes('never-capture-this'));
    const menu=await browser.act({action:'click',selector:'#menu'});
    assert.equal(menu.before?.stateId!==menu.after.stateId,true);
    assert((menu.after.summary.elements as any[]).some(item=>item.tag==='nav'));
    await browser.act({action:'fill',selector:'#name',value:'Client'});
    const sent=await browser.act({action:'click',selector:'#send'});
    assert((sent.after.summary.elements as any[]).some(item=>item.text?.includes('Hello Client')));
    const mobile=await browser.act({action:'viewport',width:320,height:568});
    assert.equal(mobile.after.viewport.width,320);
    assert.equal(forbidden,0);
    assert(browser.network.some(item=>item.blocked));
    const edge=JSON.parse(await readFile(store.records.find(item=>item.id===sent.transitionId)!.filename,'utf8'));
    assert.equal(edge.observed,true);assert.equal(edge.beforeStateId,sent.before!.stateId);assert.equal(edge.afterStateId,sent.after.stateId);
    await assert.rejects(browser.act({action:'navigate',path:blocked}),/preview_path_required/);
    await assert.rejects(browser.act({action:'navigate',path:'/redirect'}));
    assert.equal(forbidden,0);
  }finally{
    await browser.close();server.closeAllConnections();other.closeAllConnections();
    await new Promise<void>(done=>server.close(()=>done()));await new Promise<void>(done=>other.close(()=>done()));
    await rm(root,{recursive:true,force:true});
  }
});

test('a script-heavy preview loads all dependencies within the gateway connection limit',async()=>{
  const root=await mkdtemp(join(tmpdir(),'factory-script-limit-'));let active=0,peak=0;
  const server=createServer((request,response)=>{
    assert.equal(request.headers.authorization,'Bearer fixture-preview');
    response.setHeader('Connection','close');
    const script=request.url?.match(/^\/script-(\d+)\.js$/);
    if(script){active++;peak=Math.max(peak,active);setTimeout(()=>{response.setHeader('Content-Type','application/javascript');response.end(`window.loaded.push(${Number(script[1])});`);active--;},60);return;}
    response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Many scripts</title><main>Script dependency fixture</main><script>window.loaded=[];</script>'+Array.from({length:48},(_,index)=>`<script defer src="/script-${index}.js"></script>`).join(''));
  });server.maxConnections=8;
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const origin=`http://127.0.0.1:${(server.address()as AddressInfo).port}`,browser=new AgentBrowser(origin,'fixture-preview',new AgentArtifacts(root,16777216),new AbortController().signal);
  const errors:string[]=[];
  try{await browser.open();await browser.protectedPage(async page=>{page.on('pageerror',error=>errors.push(error.message));await page.goto(origin,{waitUntil:'networkidle'});
    assert.equal(await page.evaluate(()=>(window as any).loaded.length),48);});assert.deepEqual(errors,[]);assert(peak<=6);assert(!browser.network.some(item=>item.blocked));}
  finally{await browser.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(root,{recursive:true,force:true});}
});

test('redirects retain the real URL, cookies and POST semantics without opening the browser network',async()=>{
  const root=await mkdtemp(join(tmpdir(),'factory-redirects-'));let result:{method:string;body:string;cookie:string}|undefined;
  const server=createServer(async(request,response)=>{
    assert.equal(request.headers.authorization,'Bearer fixture-preview');
    if(request.url==='/redirect'){response.writeHead(302,{Location:'/target','Set-Cookie':'flow=observed; HttpOnly; Path=/'});response.end();return;}
    if(request.url==='/form'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><meta charset="utf-8"><title>Post flow</title><form method="post" action="/post"><input name="name" id="name"><button id="send">Send</button></form>');return;}
    if(request.url==='/post'){response.writeHead(307,{Location:'/target'});response.end();return;}
    let body='';for await(const chunk of request)body+=chunk;result={method:request.method!,body,cookie:request.headers.cookie??''};
    response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Final target</title><main><h1>Target</h1></main>');
  });await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const origin=`http://127.0.0.1:${(server.address()as AddressInfo).port}`,browser=new AgentBrowser(origin,'fixture-preview',new AgentArtifacts(root,16777216),new AbortController().signal);
  try{
    await browser.open();const redirected=await browser.act({action:'navigate',path:'/redirect'});assert.equal(redirected.after.path,'/target');assert.equal(browser.httpStatus,200);assert(result?.cookie.includes('flow=observed'));
    await browser.protectedPage(async page=>{await page.goto(origin+'/form');await page.locator('#name').fill('مشتری فارسی');await page.locator('#send').click();await page.waitForURL(origin+'/target');});
    assert.equal(result?.method,'POST');assert.equal(new URLSearchParams(result?.body).get('name'),'مشتری فارسی');assert(result?.cookie.includes('flow=observed'));
    assert(browser.network.some(item=>item.path==='/post'&&item.status===307));assert(!browser.network.some(item=>item.blocked));
  }finally{await browser.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(root,{recursive:true,force:true});}
});

test('authenticated previews accept real same-origin forms and reject foreign or null origins',async()=>{
  const root=await mkdtemp(join(tmpdir(),'factory-preview-form-'));
  const received:Array<{origin:string|undefined;body:string;type:string|undefined}>=[];
  const upstream=createServer(async(request,response)=>{
    if(request.method==='POST'){
      let body='';for await(const chunk of request)body+=chunk;
      received.push({origin:request.headers.origin,body,type:request.headers['content-type']});
      response.setHeader('Content-Type','text/html; charset=utf-8');response.end('<!doctype html><title>Submitted</title><main>Saved</main>');return;
    }
    response.setHeader('Content-Type','text/html; charset=utf-8');response.end(`<!doctype html><meta charset="utf-8"><title>Preview form</title><form method="post" action="/submitted" ${request.url?.includes('multipart')?'enctype="multipart/form-data"':''}><input name="name" id="name"><button id="send">Send</button></form>`);
  });
  await new Promise<void>(done=>upstream.listen(join(root,'upstream.sock'),done));
  const reservation=createServer();await new Promise<void>(done=>reservation.listen(0,'127.0.0.1',done));
  const port=(reservation.address()as AddressInfo).port;await new Promise<void>(done=>reservation.close(()=>done()));
  const gateway=createPreview(port,'a4c053c4-644e-458c-bc96-4296bbb1aa19','fixture-preview',join(root,'upstream.sock'));
  await new Promise<void>(done=>gateway.listen(port,'127.0.0.1',done));
  const origin=`http://127.0.0.1:${port}`,browser=new AgentBrowser(origin,'fixture-preview',new AgentArtifacts(root,16777216),new AbortController().signal);
  try{
    await browser.open();await browser.protectedPage(async page=>{
      await page.goto(origin+'/form');await page.locator('#name').fill('مشتری فارسی');await page.locator('#send').click();await page.waitForURL(origin+'/submitted');
      assert.equal(browser.httpStatus,200,await page.locator('body').innerText());
    });
    assert.equal(received.length,1);assert.equal(received[0]!.origin,origin);assert.equal(new URLSearchParams(received[0]!.body).get('name'),'مشتری فارسی');
    await browser.protectedPage(async page=>{
      await page.goto(origin+'/form?multipart');await page.locator('#name').fill('سفارش فارسی');await page.locator('#send').click();await page.waitForURL(origin+'/submitted');
      assert.equal(browser.httpStatus,200,await page.locator('body').innerText());
    });
    assert.equal(received.length,2);assert.equal(received[1]!.origin,origin);assert.match(received[1]!.type!,/^multipart\/form-data; boundary=/);
    assert(received[1]!.body.includes('name="name"'));assert(received[1]!.body.includes('سفارش فارسی'));
    for(const denied of ['null','https://foreign.example']){
      const response=await fetch(origin+'/submitted',{method:'POST',headers:{Authorization:'Bearer fixture-preview',Origin:denied},body:'name=blocked'});
      assert.equal(response.status,403);
    }
    assert.equal(received.length,2);
  }finally{
    await browser.close();gateway.closeAllConnections();upstream.closeAllConnections();
    await new Promise<void>(done=>gateway.close(()=>done()));await new Promise<void>(done=>upstream.close(()=>done()));await rm(root,{recursive:true,force:true});
  }
});
