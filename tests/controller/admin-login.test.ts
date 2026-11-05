import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentBrowser} from '../../src/agent-browser.js';
import {AgentArtifacts} from '../../src/agent-artifacts.js';
import {loginClientAdmin} from '../../src/admin-login.js';

test('client login honors its protected task destination without loading the dashboard',async()=>{
 let dashboards=0,logins=0;const server=createServer(async(req,res)=>{
  const url=new URL(req.url!,'http://fixture');
  if(url.pathname==='/wp-login.php'&&req.method==='POST'){
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const values=new URLSearchParams(Buffer.concat(chunks).toString());
   assert.equal(values.get('log'),'fixture-user');assert.equal(values.get('pwd'),'fixture-password');logins++;
   res.writeHead(302,{Location:values.get('redirect_to')!});res.end();return;
  }
  if(url.pathname==='/wp-admin/')dashboards++;
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(url.pathname==='/wp-login.php'?`<form method="post"><input id="user_login" name="log"><input id="user_pass" name="pwd" type="password"><input name="redirect_to" type="hidden" value="${url.searchParams.get('redirect_to')}"><button id="wp-submit">Log in</button></form>`:'<main>Protected product editor</main>');
 });await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const directory=await mkdtemp(join(tmpdir(),'factory-login-')),origin=`http://127.0.0.1:${(server.address()as AddressInfo).port}`,browser=new AgentBrowser(origin,'fixture',new AgentArtifacts(directory,1048576),AbortSignal.timeout(60000));
 try{
  await browser.open();await browser.protectedPage(async page=>{
   const credentials={username:'fixture-user',password:'fixture-password'};
   await assert.rejects(loginClientAdmin(page,origin,credentials,'http://localhost/private'),/login_destination_invalid/);
   await assert.rejects(loginClientAdmin(page,origin,credentials,'/checkout/'),/login_destination_invalid/);
   await loginClientAdmin(page,origin,credentials,'/wp-admin/post.php?post=42&action=edit');assert.equal(new URL(page.url()).searchParams.get('post'),'42');assert.equal(await page.locator('main').innerText(),'Protected product editor');
  });assert.equal(dashboards,0);assert.equal(logins,1);
 }finally{await browser.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(directory,{recursive:true,force:true});}
});
