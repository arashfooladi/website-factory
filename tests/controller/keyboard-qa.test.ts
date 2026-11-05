import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentBrowser} from '../../src/agent-browser.js';
import {AgentArtifacts} from '../../src/agent-artifacts.js';
import {reachByKeyboard} from '../../src/keyboard-qa.js';

for(const engine of ['chromium','firefox']as const)test(`${engine} form traversal finds reordered fields and rejects a real keyboard trap`,async()=>{
 const fields=['first','last','city','address','postcode','phone','email'];
 const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<nav><a href="#main">Main</a><input aria-label="Search"><button>Search</button></nav><main id="main"><form>${fields.map(id=>`<label>${id}<input id="${id}"></label>`).join('')}<button id="submit">Submit</button></form><input id="trap" aria-label="Trap"><input id="unreachable" aria-label="Unreachable" tabindex="-1"></main><script>document.querySelector('#trap').onkeydown=e=>{if(window.trapEnabled&&e.key==='Tab')e.preventDefault();};</script>`);});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const root=await mkdtemp(join(tmpdir(),'factory-keyboard-')),origin=`http://127.0.0.1:${(server.address()as AddressInfo).port}`,browser=new AgentBrowser(origin,'fixture',new AgentArtifacts(root,1048576),AbortSignal.timeout(120000),undefined,engine);
 try{await browser.open();await browser.protectedPage(async page=>{
  await page.goto(origin);for(const id of ['first','last','email','phone','city','address','postcode','submit','trap']){await reachByKeyboard(page,page.locator('#'+id)).catch(error=>{throw new Error(JSON.stringify(error.cause));});assert.equal(await page.evaluate(()=>document.activeElement?.id),id);}
  await page.evaluate(()=>{(window as any).trapEnabled=true;});
  await assert.rejects(reachByKeyboard(page,page.locator('#unreachable'),4),(error:Error)=>error.message==='functional_keyboard_target_unreachable'&&(error.cause as any).visited.every((item:any)=>item.id==='trap'));
 });}finally{await browser.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(root,{recursive:true,force:true});}
});
