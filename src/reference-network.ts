import {Resolver} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import {request as httpRequest,type IncomingHttpHeaders} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {createBrotliDecompress,createGunzip,createInflate} from 'node:zlib';

const denied=new BlockList();
for(const [address,prefix]of [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],
  ['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],
  ['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3],
]as const)denied.addSubnet(address,prefix,'ipv4');
for(const [address,prefix]of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]]as const)denied.addSubnet(address,prefix,'ipv6');
const globalV6=new BlockList();globalV6.addSubnet('2000::',3,'ipv6');
export function publicAddress(address:string){
  const version=isIP(address);
  return version===4?!denied.check(address,'ipv4'):version===6&&globalV6.check(address,'ipv6')&&!denied.check(address,'ipv6');
}
export function referenceUrl(raw:string){
  let url:URL;try{url=new URL(raw);}catch{throw new Error('reference_url_invalid');}
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||raw.length>2000||
    /(^|\.)(localhost|local|internal|onion)$/.test(host)||!host.includes('.')&&!isIP(host))throw new Error('reference_url_denied');
  if(isIP(host)&&!publicAddress(host))throw new Error('reference_address_denied');
  url.hash='';return url;
}
export interface ResolvedAddress {address:string;family:number}
export interface PublicReply {status:number;headers:IncomingHttpHeaders;body:Buffer}
export type PublicTransport=(url:URL,address:ResolvedAddress,headers:Record<string,string>,signal:AbortSignal,maxBytes:number)=>Promise<PublicReply>;
export const pinnedRequest:PublicTransport=async(url,address,headers,signal,maxBytes)=>new Promise((done,reject)=>{
  const request=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{
    method:'GET',agent:false,headers,signal,timeout:15000,
    // Validate every DNS answer first, then pin this exact TCP destination.
    // Keep the original URL hostname for Host, SNI and certificate validation.
    lookup:((_host:any,options:any,callback:any)=>options.all?callback(null,[address]):callback(null,address.address,address.family))as any,
  },response=>{
    let encoded=0,decoded=0;const chunks:Buffer[]=[];
    response.on('data',block=>{encoded+=block.length;if(encoded>maxBytes)request.destroy(new Error('reference_resource_limit'));});
    const encoding=response.headers['content-encoding']?.toLowerCase();
    const transform=encoding==='gzip'?createGunzip():encoding==='br'?createBrotliDecompress():encoding==='deflate'?createInflate():null;
    if(encoding&&!['identity','gzip','br','deflate'].includes(encoding)){request.destroy(new Error('reference_encoding_unsupported'));return;}
    const stream=transform?response.pipe(transform):response;
    stream.on('data',block=>{decoded+=block.length;if(decoded>maxBytes){stream.destroy(new Error('reference_resource_limit'));request.destroy();}else chunks.push(Buffer.from(block));});
    stream.on('error',reject);response.on('error',reject);
    stream.on('end',()=>{const output={...response.headers};delete output['content-encoding'];delete output['content-length'];done({status:response.statusCode??502,headers:output,body:Buffer.concat(chunks)});});
  });
  request.on('timeout',()=>request.destroy(new Error('reference_request_timeout')));
  request.on('error',reject);request.end();
});
export class PublicReferenceNetwork {
  private requests=0;
  private bytes=0;
  private active=0;
  private waiters:Array<()=>void>=[];
  private idleWaiters:Array<()=>void>=[];
  private shutdown=new AbortController();
  private resolver=new Resolver({timeout:3000,tries:1});
  readonly dependencies:{resolve:(hostname:string)=>Promise<ResolvedAddress[]>;transport:PublicTransport};
  readonly events:Array<{url:string;status:number;resourceType:string;address?:string;blocked?:boolean;reason?:string}>=[];
  onResource?:(url:string,result:PublicReply)=>Promise<void>;
  constructor(readonly signal:AbortSignal,readonly limits={maxRequests:600,maxBytes:100663296,maxResourceBytes:4194304},
    dependencies?:{resolve:(hostname:string)=>Promise<ResolvedAddress[]>;transport:PublicTransport}){
    this.dependencies=dependencies??{resolve:hostname=>this.dnsRecords(hostname),transport:pinnedRequest};
  }
  private async dnsRecords(hostname:string){
    // c-ares avoids letting untrusted DNS names occupy the host's filesystem
    // worker pool. Query both families and fail closed on an indeterminate one.
    const results=await Promise.allSettled([this.resolver.resolve4(hostname),this.resolver.resolve6(hostname)]);
    const records:ResolvedAddress[]=[];
    for(const [index,result]of results.entries()){
      if(result.status==='fulfilled')records.push(...result.value.map(address=>({address,family:index===0?4:6})));
      else if(!['ENODATA','ENOTFOUND'].includes(result.reason?.code))throw new Error('reference_dns_failed');
    }
    return records;
  }
  permits(url:URL){try{referenceUrl(url.href);return true;}catch{return false;}}
  blocked(raw:string,resourceType:string,reason:string){
    const url=new URL(raw);url.username='';url.password='';this.events.push({url:url.href,resourceType,status:0,blocked:true,reason});
  }
  async resolve(url:URL){
    const host=url.hostname.replace(/^\[|\]$/g,'');
    const signal=AbortSignal.any([this.signal,this.shutdown.signal,AbortSignal.timeout(10000)]);
    if(signal.aborted)throw new Error('reference_cancelled');
    const records=isIP(host)?[{address:host,family:isIP(host)}]:await new Promise<ResolvedAddress[]>((done,reject)=>{
      const cancelled=()=>reject(new Error('reference_dns_timeout'));
      signal.addEventListener('abort',cancelled,{once:true});
      this.dependencies.resolve(host).then(done,reject).finally(()=>signal.removeEventListener('abort',cancelled));
    });
    if(!records.length||records.some(item=>![4,6].includes(item.family)||isIP(item.address)!==item.family||!publicAddress(item.address)))throw new Error('reference_address_denied');
    return records[0]!;
  }
  async validate(raw:string){const url=referenceUrl(raw);await this.resolve(url);return url;}
  async fetch(raw:string,method:string,inputHeaders:Record<string,string>,signal:AbortSignal,resourceType='other'){
    const url=referenceUrl(raw);
    let acquired=false;
    try{
      if(!['GET','HEAD'].includes(method))throw new Error('reference_write_request_denied');
      if(++this.requests>this.limits.maxRequests||this.bytes>=this.limits.maxBytes)throw new Error('reference_network_budget_exceeded');
      if(this.active>=8)await new Promise<void>(done=>this.waiters.push(done));else this.active++;
      acquired=true;
      if(signal.aborted||this.signal.aborted||this.shutdown.signal.aborted)throw new Error('reference_cancelled');
      if(this.bytes>=this.limits.maxBytes)throw new Error('reference_network_budget_exceeded');
      const address=await this.resolve(url);
      const headers:Record<string,string>={'user-agent':'WebsiteFactoryReference/0.1','accept-encoding':'identity'};
      for(const name of ['accept','accept-language','cookie','range','referer'])if(inputHeaders[name])headers[name]=inputHeaders[name];
      const result=await this.dependencies.transport(url,address,headers,AbortSignal.any([signal,this.signal,this.shutdown.signal,AbortSignal.timeout(30000)]),this.limits.maxResourceBytes);
      if(result.body.length>this.limits.maxResourceBytes)throw new Error('reference_resource_limit');
      this.bytes+=result.body.length;if(this.bytes>this.limits.maxBytes)throw new Error('reference_network_budget_exceeded');
      if(result.status>=300&&result.status<400&&result.headers.location)await this.validate(new URL(result.headers.location,url).href);
      await this.onResource?.(url.href,result);
      const responseHeaders=new Headers();
      for(const [key,value]of Object.entries(result.headers)){
        if(['connection','transfer-encoding','content-length','content-encoding'].includes(key)||value===undefined)continue;
        for(const item of Array.isArray(value)?value:[value])responseHeaders.append(key,item);
      }
      this.events.push({url:url.href,status:result.status,resourceType,address:address.address});
      return new Response([204,205,304].includes(result.status)?null:Uint8Array.from(result.body),{status:result.status,headers:responseHeaders});
    }catch(error){
      this.events.push({url:url.href,status:0,resourceType,blocked:true,reason:error instanceof Error&&error.message.startsWith('reference_')?error.message:'reference_fetch_failed'});
      throw error;
    }finally{if(acquired){const next=this.waiters.shift();if(next)next();else this.active--;if(this.active===0){for(const done of this.idleWaiters.splice(0))done();}}}
  }
  async close(){this.shutdown.abort();this.resolver.cancel();if(this.active)await new Promise<void>(done=>this.idleWaiters.push(done));}
}
