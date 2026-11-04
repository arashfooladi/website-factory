import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentBrowser} from '../../src/agent-browser.js';
import {AgentArtifacts} from '../../src/agent-artifacts.js';

test('controlled browser preserves binary file bytes in a real multipart upload',async()=>{
 const root=await mkdtemp(join(tmpdir(),'factory-upload-')),payload=Buffer.from([0,255,1,2,128,13,10,65,66,0]);let received:Buffer|null=null;
 const server=createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer fixture');
  if(req.method==='POST'){const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));received=Buffer.concat(chunks);res.end('<main>Uploaded</main>');return;}
  res.setHeader('Content-Type','text/html');res.end('<form action="/uploaded" method="post" enctype="multipart/form-data"><input type="file" name="file" id="file"><button>Upload</button></form>');
 });await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const origin=`http://127.0.0.1:${(server.address()as AddressInfo).port}`,browser=new AgentBrowser(origin,'fixture',new AgentArtifacts(root,1048576),new AbortController().signal);
 try{await browser.open();await browser.protectedPage(async page=>{await page.goto(origin);await page.locator('#file').setInputFiles({name:'fixture.bin',mimeType:'application/octet-stream',buffer:payload});await page.getByRole('button',{name:'Upload'}).click();await page.waitForURL(origin+'/uploaded');});
  assert(received);assert((received as Buffer).includes(payload),'Multipart transfer must preserve every binary byte');
 }finally{await browser.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(root,{recursive:true,force:true});}
});
