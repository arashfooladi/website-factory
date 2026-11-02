import { createServer,type Server } from 'node:http';
import { randomBytes,createHash,timingSafeEqual } from 'node:crypto';
import { mkdir,open,chmod,writeFile,type FileHandle } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentBudget,ProviderUsage,DynamicTool } from './agent-contracts.js';

const exec=promisify(execFile);
const digest=(value:string)=>createHash('sha256').update(value).digest();
export function filterTools(tools:unknown,allowed:Set<string>):unknown[]{
  if(!Array.isArray(tools))return[];
  return tools.flatMap(tool=>{
    if(tool?.type==='function'&&allowed.has(tool.name))return[tool];
    if(tool?.type==='namespace'&&Array.isArray(tool.tools)){
      const nested=filterTools(tool.tools,allowed);
      return nested.length?[{...tool,tools:nested}]:[];
    }return[];
  });
}
export function validateProviderEvents(events:any[],allowed:Set<string>){
  const check=(item:any)=>{
    if(!item||typeof item!=='object')return;
    if(item.type==='function_call'){
      if(!allowed.has(item.name)||item.namespace&&item.namespace!=='functions')throw new Error('provider_tool_denied');
    }else if(typeof item.type==='string'&&item.type.endsWith('_call'))throw new Error('provider_tool_denied');
  };
  for(const event of events){
    check(event.item);
    for(const item of event.response?.output??[])check(item);
    if(event.type==='response.function_call_arguments.done'&&event.name&&!allowed.has(event.name))throw new Error('provider_tool_denied');
  }
  const last=events.findLast(event=>['response.completed','response.failed','response.incomplete'].includes(event.type));
  if(!last||last.type!=='response.completed'||last.response?.status!=='completed')throw new Error('provider_response_incomplete');
  return last.response;
}
export type InferenceTransport=(payload:any,signal:AbortSignal)=>Promise<any[]>;
export function prepareProviderRequest(input:any,allowed:Set<string>,definitions?:DynamicTool[]){
  // Codex 0.166 advertises an internal code-mode registry as input data.
  // Replace it with direct functions so only assigned tools reach inference.
  input.input=(input.input??[]).filter((item:any)=>item.type!=='additional_tools');
  input.tools=definitions
    ?definitions.length?[{type:'namespace',name:'functions',description:'Assigned Website Factory capabilities.',tools:definitions.map(tool=>({type:'function',name:tool.name,description:tool.description,parameters:tool.inputSchema,strict:false}))}]:[]
    :filterTools(input.tools,allowed);
  input.store=false;input.stream=true;
  return input;
}
export function loginTransport(credentialFile:string):InferenceTransport{
  return async(payload,signal)=>{
    // A full site/design submission can stream for longer than three minutes.
    // The assigned agent deadline/cancellation still aborts this exact process.
    const child=exec('python3',[resolve('tools/provider_request.py'),credentialFile],{signal,timeout:600_000,maxBuffer:16*1024*1024});
    child.child.stdin?.end(JSON.stringify(payload));
    let output:string;
    try{output=(await child).stdout;}
    catch(error:any){if(error.killed&&!signal.aborted)throw new Error('provider_request_timeout');throw error;}
    const result=JSON.parse(output);
    if(result.error)throw Object.assign(new Error(result.error),{httpStatus:Number.isInteger(result.httpStatus)?result.httpStatus:undefined});
    return result.events;
  };
}
export class ProviderProxy {
  readonly token=randomBytes(32).toString('hex');
  readonly usage:ProviderUsage={inputTokens:0,cachedInputTokens:0,outputTokens:0,totalTokens:0,costMicros:null,confirmed:true};
  private server?:Server;
  private directory?:FileHandle;
  private calls=0;
  private shutdown=new AbortController();
  private inferences=new Set<Promise<any[]>>();
  private unknownUsage=false;
  errorCode?:string;
  constructor(readonly root:string,readonly model:string,readonly allowed:Set<string>,readonly limits:AgentBudget,
    readonly signal:AbortSignal,readonly transport:InferenceTransport,readonly onFailure:(code:string)=>void,readonly definitions?:DynamicTool[]){}
  async open(){
    await mkdir(this.root,{recursive:true,mode:0o700});this.directory=await open(this.root,'r');
    this.server=createServer(async(request,response)=>{
      const reply=(status:number,code:string)=>{if(!response.headersSent)response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify({error:{message:code,type:'factory_provider_error',code}}));};
      try{
        if(!timingSafeEqual(digest(request.headers.authorization??''),digest(`Bearer ${this.token}`)))return reply(401,'invalid_provider_capability');
        if(request.method!=='POST'||request.url!=='/v1/responses')return reply(404,'provider_route_denied');
        if(this.signal.aborted)throw new Error('agent_cancelled');
        if(++this.calls>this.limits.maxToolCalls+5||this.usage.totalTokens>=this.limits.maxObservedTokens)throw new Error('observed_token_budget_exceeded');
        const buffers:Buffer[]=[];let bytes=0;
        for await(const block of request){bytes+=block.length;if(bytes>4*1024*1024)throw new Error('provider_request_limit');buffers.push(Buffer.from(block));}
        const input=JSON.parse(Buffer.concat(buffers).toString());
        if(input.model!==this.model)throw new Error('provider_model_denied');
        const catalog=(tools:any[]):any[]=>tools.map(tool=>({type:tool.type,name:tool.name,namespace:tool.namespace,
          ...(Array.isArray(tool.tools)?{tools:catalog(tool.tools)}:{})}));
        await writeFile(join(this.root,'input-shape.json'),JSON.stringify({keys:Object.keys(input),
          items:(input.input??[]).map((item:any)=>({type:item.type,keys:Object.keys(item)}))}),{mode:0o600});
        await writeFile(join(this.root,'tool-catalog.json'),JSON.stringify(catalog(input.tools??[])),{mode:0o600});
        prepareProviderRequest(input,this.allowed,this.definitions);
        // No unapproved built-in call is ever delivered to the Codex harness.
        // Buffer and validate the complete inference response before replaying it.
        let events:any[];
        const inference=this.transport(input,AbortSignal.any([this.signal,this.shutdown.signal]));
        this.inferences.add(inference);this.usage.confirmed=false;
        try{
          events=await inference;
          const usage=events.findLast(event=>event.response?.usage)?.response.usage;
          if(!usage||!['input_tokens','output_tokens','total_tokens'].every(key=>Number.isSafeInteger(usage[key])&&usage[key]>=0))throw new Error('provider_usage_missing');
          this.usage.inputTokens+=usage.input_tokens;
          this.usage.cachedInputTokens+=usage.input_tokens_details?.cached_tokens??0;
          this.usage.outputTokens+=usage.output_tokens;
          this.usage.totalTokens+=usage.total_tokens;
        }catch(error){this.unknownUsage=true;throw error;}
        finally{this.inferences.delete(inference);this.usage.confirmed=!this.unknownUsage&&this.inferences.size===0;}
        await writeFile(join(this.root,'returned-tools.json'),JSON.stringify(events.flatMap(event=>[event.item,...(event.response?.output??[])]).filter(item=>item?.type?.endsWith('_call')).map(item=>({type:item.type,name:item.name,namespace:item.namespace}))),{mode:0o600});
        validateProviderEvents(events,this.allowed);
        if(this.usage.totalTokens>this.limits.maxObservedTokens)throw new Error('observed_token_budget_exceeded');
        response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'close'});
        for(const event of events)response.write(`data: ${JSON.stringify(event)}\n\n`);
        response.end();
      }catch(error){
        const known=new Set(['provider_tool_denied','provider_response_incomplete','provider_usage_missing','observed_token_budget_exceeded',
          'provider_model_denied','provider_request_limit','provider_request_timeout','provider_auth_failed','codex_login_required','provider_http_failed','agent_cancelled']);
        const code=error instanceof Error&&known.has(error.message)?error.message:'provider_transport_failed';
        const httpStatus=(error as any)?.httpStatus;
        await writeFile(join(this.root,'failure.json'),JSON.stringify({code,...(Number.isInteger(httpStatus)&&httpStatus>=100&&httpStatus<=599?{httpStatus}:{})}),{mode:0o600}).catch(()=>{});
        this.errorCode=code;reply(502,code);this.onFailure(code);
      }
    });
    this.server.requestTimeout=180_000;this.server.headersTimeout=10_000;this.server.maxConnections=4;
    await new Promise<void>((done,reject)=>{this.server!.once('error',reject);this.server!.listen(`/proc/self/fd/${this.directory!.fd}/provider.sock`,done);});
    await chmod(join(this.root,'provider.sock'),0o600);
    return this;
  }
  async close(){
    this.shutdown.abort('provider_closed');
    await Promise.allSettled([...this.inferences]);
    if(this.server){this.server.closeAllConnections();await new Promise<void>(done=>this.server!.close(()=>done()));}
    await this.directory?.close();
  }
}
