import type {Controller} from './controller.js';
import type {Environments} from './environments.js';

export class VisualPreview{
 private id?:string;
 constructor(readonly controller:Controller,readonly environments:Environments,readonly review:any,readonly signal:AbortSignal,
  readonly event:(type:string,data:Record<string,unknown>)=>Promise<void>,readonly purpose:'visual'|'functional'='visual',readonly reviewKind:'visual'|'functional'='visual'){}
 private async settled(status:string,signal?:AbortSignal){
  const until=Date.now()+600000;
  while(Date.now()<until){
   signal?.throwIfAborted();const state=await this.environments.inspect(this.controller.config.ownerId,this.id!);
   if(state.status==='failed')throw new Error('visual_preview_lifecycle_failed');
   if(!state.current_operation_id&&state.status===status)return state;
   await new Promise(done=>setTimeout(done,250));
  }throw new Error('visual_preview_lifecycle_timeout');
 }
 async open(source:any){
  this.signal.throwIfAborted();
  const created=await this.environments.create(this.controller.config.ownerId,{projectId:this.review.project_id,...(source.theme_bundle_id?{themeBundleId:source.theme_bundle_id}:{}),
   limits:{...source.limits,ttlSeconds:Math.min(3600,Math.max(300,Math.ceil(this.review.input.maxRuntimeMs/1000))),retentionSeconds:3600}},
   {allocationKey:`${this.reviewKind}-${this.review.id}-${this.review.attempt_id}`});
  const id:string=created.id;this.id=id;
  await this.event('qa_environment_allocated',{environmentId:this.id});
  await this.settled('stopped',this.signal);this.signal.throwIfAborted();
  const provenance=await this.environments.runtime('clone-visual',id,[],{sourceEnvironmentId:source.id,sourceDigest:this.review.source_digest,purpose:this.purpose});
  this.signal.throwIfAborted();
  await this.environments.request(this.controller.config.ownerId,id,'start',undefined,this.reviewKind==='visual'?{visualReviewId:this.review.id}:{functionalReviewId:this.review.id});
  const environment=await this.settled('running',this.signal);
  return{environment,provenance};
 }
 async close(){
  if(!this.id)return;
  // Retention is a durable fallback if shutdown interrupts the explicit destroy operation.
  await this.controller.pool.query('UPDATE factory.environments SET retain_until=clock_timestamp() WHERE id=$1',[this.id]);
  const until=Date.now()+600000;
  while(Date.now()<until){
   const state=await this.environments.inspect(this.controller.config.ownerId,this.id);
   if(state.status==='deleted')return;
   if(!state.current_operation_id){
    try{
     await this.environments.request(this.controller.config.ownerId,this.id,'destroy',undefined,this.reviewKind==='visual'?{visualReviewId:this.review.id}:{functionalReviewId:this.review.id});
     await this.settled('deleted');return;
    }catch(error){if(!(error instanceof Error)||error.message!=='environment_busy')throw error;}
   }
   await new Promise(done=>setTimeout(done,250));
  }throw new Error('visual_preview_cleanup_timeout');
 }
}
