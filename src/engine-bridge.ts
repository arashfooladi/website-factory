import {createServer} from 'node:http';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {firefox,webkit} from '@playwright/test';

export interface EngineRequest {
 url:string;method:string;headers:Record<string,string>;resourceType:string;main:boolean;
 body:()=>Promise<Buffer>;abort:(reason:'blockedbyclient'|'failed')=>Promise<void>;
 fulfill:(response:{status:number;headers:Record<string,string>;body:Buffer})=>Promise<void>;
}
/** No browser network namespace has a route to the host. Only this single-origin broker fetches. */
export async function launchIsolatedEngine(engine:'firefox'|'webkit',id:string,bridge:(request:EngineRequest)=>Promise<void>){
 const type=engine==='firefox'?firefox:webkit;
 try{await access(type.executablePath());}catch{throw new Error('browser_engine_unavailable');}
 const directory=await mkdtemp(join(tmpdir(),'factory-engine-')),socket=join(directory,'bridge.sock');
 const server=createServer(async(request,response)=>{
  try{
   let size=0;const chunks:Buffer[]=[];for await(const chunk of request){size+=chunk.length;if(size>16*1024*1024)throw new Error('engine_body_limit');chunks.push(Buffer.from(chunk));}
   const headers:Record<string,string>={};for(const [key,value]of Object.entries(request.headers))if(value!==undefined)headers[key]=Array.isArray(value)?value.join('\n'):value;
   await bridge({url:request.url??'',method:request.method??'GET',headers,resourceType:headers['sec-fetch-dest']==='document'?'document':'other',main:headers['sec-fetch-dest']==='document',body:async()=>Buffer.concat(chunks),
    abort:async()=>{response.writeHead(403);response.end();},fulfill:async result=>{const output:Record<string,string|string[]>={...result.headers};if(result.headers['set-cookie'])output['set-cookie']=result.headers['set-cookie'].split('\n');response.writeHead(result.status,output);response.end(result.body);}});
  }catch{if(!response.headersSent)response.writeHead(502);response.end();}
 });
 await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(socket,done);});
 const close=async()=>{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));await rm(directory,{recursive:true,force:true});};
 try{
  const browser=await type.launch({executablePath:resolve('tools/browser-engine-sandbox'),timeout:60000,headless:true,
   proxy:{server:'http://127.0.0.1:18765',bypass:''},...(engine==='firefox'?{firefoxUserPrefs:{'network.proxy.no_proxies_on':'','network.proxy.allow_hijacking_localhost':true}}:{}),
   env:{PATH:'/usr/bin',XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR??`/run/user/${process.getuid!()}`,FACTORY_BROWSER_RUN:id,FACTORY_ENGINE_BINARY:type.executablePath(),FACTORY_ENGINE_SOCKET:socket,...(process.env.DBUS_SESSION_BUS_ADDRESS?{DBUS_SESSION_BUS_ADDRESS:process.env.DBUS_SESSION_BUS_ADDRESS}:{})}});
  return{browser,close};
 }catch(error){await close();throw new Error('browser_engine_launch_failed',{cause:error});}
}
