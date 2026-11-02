import { chromium,type Browser,type BrowserContext,type Page,type CDPSession } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { AgentArtifacts } from './agent-artifacts.js';
import { BrowserAction,type ExperienceObservation } from './agent-contracts.js';

const exec=promisify(execFile);
const blockedHeaders=new Set(['host','connection','content-length','transfer-encoding','accept-encoding','authorization']);
export interface BrowserNetwork {
  permits(url:URL):boolean;
  fetch(url:string,method:string,headers:Record<string,string>,signal:AbortSignal,resourceType?:string):Promise<Response>;
  blocked?(url:string,resourceType:string,reason:string):void;
}
interface BridgeResource {
  url:string;method:string;headers:Record<string,string>;resourceType:string;main:boolean;
  body:()=>Promise<Buffer>;
  abort:(reason:'blockedbyclient'|'failed')=>Promise<void>;
  fulfill:(response:{status:number;headers:Record<string,string>;body:Buffer})=>Promise<void>;
}
export class AgentBrowser {
  private browser?:Browser;
  private context?:BrowserContext;
  private page?:Page;
  private bridgeSession?:CDPSession;
  private mainFrameId='';
  private redirectDepth=new Map<string,number>();
  private serial:Promise<unknown>=Promise.resolve();
  private requests=0;
  private mainStatus=0;
  private settled=true;
  private blockedNavigations=0;
  private blockedPopups=0;
  private bridgeActive=0;
  private bridgeWaiters:Array<{ready:()=>void;abort:()=>void}>=[];
  private dialogs:Array<{type:string;message:string;action:string}>=[];
  get httpStatus(){return this.mainStatus;}
  // Trusted controller suites only. This callback is never exposed as an agent tool.
  protectedPage<T>(work:(page:Page)=>Promise<T>):Promise<T>{
    const result=this.serial.then(async()=>{this.check();if(!this.page)throw new Error('browser_not_open');return work(this.page);});
    this.serial=result.catch(()=>{});return result;
  }
  readonly id=randomUUID();
  readonly network:Array<{path:string;status:number;blocked?:boolean;reason?:string}>=[];
  private aborted=()=>{void this.close();};
  constructor(readonly origin:string,private token:string,readonly artifacts:AgentArtifacts,readonly signal:AbortSignal,private networkAccess?:BrowserNetwork){
    const url=new URL(origin);
    if(networkAccess?!networkAccess.permits(url):url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.origin!==origin)throw new Error('invalid_preview_origin');
  }
  private inScope(url:URL){return this.networkAccess?this.networkAccess.permits(url):url.origin===this.origin;}
  private check(){if(this.signal.aborted)throw new Error('agent_cancelled');}
  private async bridgeSlot(){
    this.check();
    if(this.bridgeActive<6){this.bridgeActive++;return;}
    await new Promise<void>((resolve,reject)=>{
      const entry={ready:()=>{this.signal.removeEventListener('abort',entry.abort);resolve();},abort:()=>{
        const index=this.bridgeWaiters.indexOf(entry);if(index>=0)this.bridgeWaiters.splice(index,1);
        reject(new Error('browser_aborted'));
      }};
      this.bridgeWaiters.push(entry);this.signal.addEventListener('abort',entry.abort,{once:true});
      if(this.signal.aborted)entry.abort();
    });
  }
  private releaseBridge(){const next=this.bridgeWaiters.shift();if(next)next.ready();else this.bridgeActive--;}
  async open(viewport={width:1280,height:900}){
    this.check();
    this.signal.addEventListener('abort',this.aborted,{once:true});
    this.browser=await chromium.launch({executablePath:resolve('tools/browser-sandbox'),timeout:60_000,
      env:{PATH:'/usr/bin',XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR??`/run/user/${process.getuid!()}`,
        ...(process.env.DBUS_SESSION_BUS_ADDRESS?{DBUS_SESSION_BUS_ADDRESS:process.env.DBUS_SESSION_BUS_ADDRESS}:{}),FACTORY_BROWSER_RUN:this.id}});
    this.check();
    this.context=await this.browser.newContext({viewport,serviceWorkers:'block',acceptDownloads:false});
    await this.context.routeWebSocket('**/*',socket=>socket.close());
    this.page=await this.context.newPage();
    this.bridgeSession=await this.context.newCDPSession(this.page);
    const session=this.bridgeSession;
    await session.send('Page.enable');
    this.mainFrameId=(await session.send('Page.getFrameTree')).frameTree.frame.id;
    session.on('Page.frameNavigated',event=>{if(!event.frame.parentId)this.mainFrameId=event.frame.id;});
    // Playwright routes skip redirected requests. Intercept every Chromium
    // request here so redirects retain real URLs, methods and cookie handling
    // while no socket ever leaves the browser's network namespace.
    session.on('Fetch.requestPaused',event=>{void this.intercept(session,event).catch(async()=>{
      await session.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'Failed'}).catch(()=>{});
    });});
    await session.send('Network.enable');await session.send('Network.setCacheDisabled',{cacheDisabled:true});
    await session.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
    this.page.setDefaultTimeout(5000);
    this.page.setDefaultNavigationTimeout(30_000);
    this.context.on('page',page=>{if(page!==this.page){this.blockedPopups++;void page.close();}});
    this.page.on('dialog',dialog=>{this.dialogs.push({type:dialog.type(),message:dialog.message().slice(0,2000),action:'dismissed-by-capture'});void dialog.dismiss().catch(()=>{});});
    return this;
  }
  private async intercept(session:CDPSession,event:any){
    const depth=event.redirectedRequestId?(this.redirectDepth.get(event.redirectedRequestId)??0)+1:0;
    if(event.redirectedRequestId)this.redirectDepth.delete(event.redirectedRequestId);
    this.redirectDepth.set(event.requestId,depth);
    if(this.redirectDepth.size>1200)this.redirectDepth.delete(this.redirectDepth.keys().next().value!);
    if(depth>10){this.blockedNavigations++;this.mainStatus=0;this.network.push({path:new URL(event.request.url).pathname,status:0,blocked:true,reason:'browser_redirect_limit'});
      await session.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'});return;}
    await this.route({url:event.request.url,method:event.request.method,headers:event.request.headers,resourceType:String(event.resourceType).toLowerCase(),
      main:event.resourceType==='Document'&&event.frameId===this.mainFrameId,
      body:async()=>{
        const entries=event.request.postDataEntries;
        let data:Buffer;
        if(entries?.length&&entries.every((item:any)=>typeof item.bytes==='string')){
          if(entries.reduce((bytes:number,item:any)=>bytes+item.bytes.length,0)>24*1024*1024)throw new Error('browser_upload_limit');
          data=Buffer.concat(entries.map((item:any)=>Buffer.from(item.bytes,'base64')));
        }else if(event.request.hasPostData||event.request.postData||entries?.length){
          // Never silently omit file bytes from an unsupported multipart body.
          const mime=Object.entries(event.request.headers).find(([key])=>key.toLowerCase()==='content-type')?.[1];
          if(String(mime).startsWith('multipart/'))throw new Error('browser_upload_capture_unsupported');
          const text=event.request.postData??(await session.send('Network.getRequestPostData',{requestId:event.networkId})).postData;
          data=Buffer.from(text,'utf8');
        }else data=Buffer.alloc(0);
        if(data.length>16*1024*1024)throw new Error('browser_upload_limit');return data;
      },
      abort:async reason=>{await session.send('Fetch.failRequest',{requestId:event.requestId,errorReason:reason==='blockedbyclient'?'BlockedByClient':'Failed'});},
      fulfill:async response=>{await session.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:response.status,
        responseHeaders:Object.entries(response.headers).flatMap(([name,value])=>(name.toLowerCase()==='set-cookie'?value.split('\n'):[value]).map(item=>({name,value:item}))),
        body:response.body.toString('base64')});},
    });
  }
  private async route(request:BridgeResource){
    const url=new URL(request.url);
    const mainNavigation=request.main;
    if(this.signal.aborted||!this.inScope(url)||url.username||url.password||++this.requests>1000){
      if(mainNavigation){this.mainStatus=0;this.blockedNavigations++;}
      this.networkAccess?.blocked?.(url.href,request.resourceType,'reference_browser_url_denied');
      this.network.push({path:url.origin===this.origin?url.pathname:'[other origin]',status:0,blocked:true});
      await request.abort('blockedbyclient').catch(()=>{});return;
    }
    let bridgeHeld=false;
    try{
      await this.bridgeSlot();bridgeHeld=true;this.check();
      // Chromium has no network. Only this trusted bridge can fetch a resource,
      // and it fetches the assigned preview origin without following redirects.
      const headers:Record<string,string>={};
      for(const [rawKey,value]of Object.entries(request.headers)){const key=rawKey.toLowerCase();if(!blockedHeaders.has(key))headers[key]=value;}
      if(!this.networkAccess){headers.authorization=`Bearer ${this.token}`;headers.connection='close';}
      const response=this.networkAccess?await this.networkAccess.fetch(request.url,request.method,headers,this.signal,request.resourceType):await fetch(request.url,{method:request.method,headers,
        body:['GET','HEAD'].includes(request.method)?undefined:Uint8Array.from(await request.body()),redirect:'manual',
        signal:AbortSignal.any([this.signal,AbortSignal.timeout(30_000)])});
      if(mainNavigation)this.mainStatus=response.status;
      const chunks:Buffer[]=[];let bytes=0;
      const reader=response.body?.getReader();
      if(reader)try{
        for(;;){const value=await reader.read();if(value.done)break;
          bytes+=value.value.length;if(bytes>4*1024*1024)throw new Error('browser_resource_limit');chunks.push(Buffer.from(value.value));}
      }finally{await reader.cancel().catch(()=>{});}
      const output:Record<string,string>={};
      for(const [key,value]of response.headers)if(!['content-encoding','content-length','transfer-encoding','connection','set-cookie'].includes(key))output[key]=value;
      const cookies=response.headers.getSetCookie();if(cookies.length)output['set-cookie']=cookies.join('\n');
      this.network.push({path:url.pathname,status:response.status});
      await request.fulfill({status:response.status,headers:output,body:Buffer.concat(chunks)});
    }catch{if(mainNavigation){this.mainStatus=0;this.blockedNavigations++;}
      this.network.push({path:url.pathname,status:0,blocked:true,reason:this.signal.aborted?'browser_aborted':'browser_resource_failed'});
      await request.abort('failed').catch(()=>{});
    }finally{if(bridgeHeld)this.releaseBridge();}
  }
  act(raw:unknown):Promise<{before:ExperienceObservation|null;after:ExperienceObservation;transitionId:string;restrictedEffect:boolean}>{
    const action=BrowserAction.parse(raw);
    const result=this.serial.then(async()=>{
      this.check();if(!this.page)throw new Error('browser_not_open');
      const before=this.inScope(new URL(this.page.url()))?await this.capture():null;
      const previousFailures=this.blockedNavigations+this.blockedPopups;
      let restrictedEffect=false;
      if(this.networkAccess&&(action.action==='click'||action.action==='press'&&action.key==='Enter')){
        restrictedEffect=await this.page.locator(action.selector).first().evaluate((node,command)=>{
          const element=node as HTMLInputElement|HTMLButtonElement;
          const form=element.form;
          const type=(element.getAttribute('type')??(element.tagName==='BUTTON'?'submit':'text')).toLowerCase();
          const submits=command==='click'?['submit','image'].includes(type):element.tagName==='INPUT'&&!['button','checkbox','radio','reset'].includes(type);
          const method=(element.getAttribute('formmethod')??form?.method??'get').toLowerCase();
          return Boolean(form&&submits&&!['get','dialog'].includes(method));
        },action.action).catch(()=>false);
      }
      switch(action.action){
        case'navigate':{
          const target=new URL(action.path,this.origin);
          if(this.networkAccess){if(!this.inScope(target))throw new Error('reference_url_denied');}
          else if(!action.path.startsWith('/')||action.path.startsWith('//')||target.origin!==this.origin)throw new Error('preview_path_required');
          await this.page.goto(target.href,{waitUntil:'domcontentloaded'});
          if(this.networkAccess){await this.page.waitForLoadState('load',{timeout:10000}).catch(()=>{});}
          break;}
        case'click':await this.page.locator(action.selector).first().click();break;
        case'fill':await this.page.locator(action.selector).first().fill(action.value);break;
        case'press':await this.page.locator(action.selector).first().press(action.key);break;
        case'scroll':await this.page.evaluate(({x,y})=>window.scrollBy(x,y),action);break;
        case'viewport':await this.page.setViewportSize({width:action.width,height:action.height});break;
        case'inspect':break;
      }
      if(this.networkAccess){
        this.settled=await this.page.waitForLoadState('networkidle',{timeout:3000}).then(()=>true,()=>false);
      }
      this.check();
      const after=await this.capture();
      restrictedEffect||=Boolean(this.networkAccess&&(this.blockedNavigations+this.blockedPopups>previousFailures||this.mainStatus===0));
      const command=action.action==='fill'?{...action,value:'[entered by agent]'}:action;
      const transition=await this.artifacts.save('interaction','application/json',JSON.stringify({version:1,id:randomUUID(),
        beforeStateId:before?.stateId??null,afterStateId:after.stateId,command,observed:true,restrictedEffect,at:new Date().toISOString()}));
      return{before,after,transitionId:transition.id,restrictedEffect};
    });
    this.serial=result.catch(()=>{});
    return result;
  }
  async capture():Promise<ExperienceObservation>{
    this.check();if(!this.page)throw new Error('browser_not_open');
    const url=new URL(this.page.url());if(!this.inScope(url))throw new Error('preview_navigation_blocked');
    await this.page.evaluate(()=>document.fonts.ready).catch(()=>{});
    this.check();
    // Keep browser code as plain JS: TS loaders can otherwise inject helpers
    // into nested functions which don't exist in the isolated page context.
    const structure=await this.page.evaluate<{html:string;title:string;scroll:{x:number;y:number};[key:string]:any}>(
      await readFile(resolve('sandbox/observe-page.js'),'utf8'));
    const viewport=this.page.viewportSize()!;
    const image=await this.page.screenshot({type:'png',animations:'disabled',timeout:10_000});
    const {html,...details}=structure;const summary={...details,httpStatus:this.mainStatus,settled:this.settled,dialogs:this.dialogs.slice(-10),blockedPopups:this.blockedPopups};
    const screenshot=await this.artifacts.save('screenshot','image/png',image);
    const source=await this.artifacts.save('rendered_html','text/html',html);
    const geometry=await this.artifacts.save('page_structure','application/json',JSON.stringify({...summary,network:this.network.slice(-50)}));
    return{version:1,stateId:randomUUID(),path:this.networkAccess?url.href:url.pathname+url.search,title:structure.title,viewport,scroll:structure.scroll,
      screenshot,html:source,structure:geometry,summary};
  }
  async close(){
    this.signal.removeEventListener('abort',this.aborted);
    await this.context?.close().catch(()=>{});await this.browser?.close().catch(()=>{});
    await exec('systemctl',['--user','stop','factory_browser_'+this.id.replaceAll('-','')+'.scope']).catch(()=>{});
  }
}
