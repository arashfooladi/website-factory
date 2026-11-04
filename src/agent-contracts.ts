import { z } from 'zod';
import { Id } from './contracts.js';

export const AgentRole = z.enum(['analyst','designer','builder','visual_reviewer','functional_tester']);
export const AgentLimits = z.object({
  maxRuntimeMs:z.number().int().min(1000).max(600_000).default(180_000),
  maxObservedTokens:z.number().int().min(100).max(1_000_000).default(100_000),
  maxToolCalls:z.number().int().min(1).max(100).default(30),
  maxArtifactBytes:z.number().int().min(1_048_576).max(67_108_864).default(33_554_432),
}).strict();
export const AgentInput = z.object({
  environmentId:Id.optional(),
  projectId:Id.optional(),
  intakeId:Id.optional(),
  designId:Id.optional(),
  publishExistingSourceSha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  role:AgentRole.default('builder'),
  prompt:z.string().trim().min(1).max(16_000),
  limits:AgentLimits.prefault({}),
}).strict().superRefine((task,context)=>{
  if(!task.environmentId&&(!task.projectId||!task.intakeId||!['analyst','designer'].includes(task.role)))context.addIssue({code:'custom',message:'environment_or_reference_project_required'});
  if(task.role==='designer'&&!task.intakeId)context.addIssue({code:'custom',message:'design_requires_intake'});
  if(task.publishExistingSourceSha256&&(task.role!=='builder'||!task.environmentId||!task.designId))context.addIssue({code:'custom',message:'existing_source_publication_requires_bound_builder_design'});
});
export type AgentBudget = z.infer<typeof AgentLimits>;
export type AgentRequest = z.infer<typeof AgentInput>;
export type AgentStatus = 'queued'|'running'|'cancelling'|'cancelled'|'completed'|'failed'|'needs_review';

export const BrowserAction = z.discriminatedUnion('action',[
  z.object({action:z.literal('navigate'),path:z.string().min(1).max(2000)}).strict(),
  z.object({action:z.literal('click'),selector:z.string().min(1).max(500)}).strict(),
  z.object({action:z.literal('fill'),selector:z.string().min(1).max(500),value:z.string().max(5000)}).strict(),
  z.object({action:z.literal('press'),selector:z.string().min(1).max(500),key:z.enum(['Enter','Escape','Tab','Space','ArrowDown','ArrowUp'])}).strict(),
  z.object({action:z.literal('scroll'),x:z.number().int().min(-4000).max(4000),y:z.number().int().min(-8000).max(8000)}).strict(),
  z.object({action:z.literal('viewport'),width:z.number().int().min(240).max(1920),height:z.number().int().min(200).max(2160)}).strict(),
  z.object({action:z.literal('inspect')}).strict(),
]);
export type BrowserCommand = z.infer<typeof BrowserAction>;
export interface EvidenceArtifact {
  id:string; kind:string; sha256:string; mediaType:string; bytes:number; candidateRevision:string|null;
}
export interface ExperienceObservation {
  version:1;
  stateId:string;
  path:string;
  title:string;
  viewport:{width:number;height:number};
  scroll:{x:number;y:number};
  screenshot:EvidenceArtifact;
  html:EvidenceArtifact;
  structure:EvidenceArtifact;
  summary:Record<string,unknown>;
}
export interface ProviderUsage {
  inputTokens:number; cachedInputTokens:number; outputTokens:number; totalTokens:number;
  costMicros:number|null; confirmed:boolean;
}
export interface ProviderOutcome {
  status:'completed'|'failed'|'cancelled'|'needs_review';
  sessionId:string|null; turnId:string|null; text:string; usage:ProviderUsage; errorCode?:string;
}
export interface DynamicTool {
  name:string; description:string; inputSchema:Record<string,unknown>;
}
export type ToolContent = {type:'inputText';text:string}|{type:'inputImage';imageUrl:string};
export interface ToolResponse {success:boolean;contentItems:ToolContent[]}
export interface AgentTask {
  runId:string; role:z.infer<typeof AgentRole>; prompt:string; instructions:string;
  instructionsHash:string; skillVersions:Record<string,string>; limits:AgentBudget;
  sessionId?:string; images?:Array<{dataUrl:string;label?:string}>; tools:DynamicTool[];
  sessionKey:string;
}
export interface ProviderAdapter {
  readonly name:string;
  run(task:AgentTask,context:{signal:AbortSignal;onEvent:(type:string,data:Record<string,unknown>)=>Promise<void>;
    onTool:(name:string,args:unknown)=>Promise<ToolResponse>}):Promise<ProviderOutcome>;
}
