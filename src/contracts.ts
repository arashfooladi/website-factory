import { z } from 'zod';

export const Id = z.uuid();
export const Limits = z.object({
  maxRuntimeMs: z.number().int().min(100).max(86_400_000).default(60_000),
  stageTimeoutMs: z.number().int().min(50).max(600_000).default(15_000),
  maxTokens: z.number().int().min(0).max(1_000_000_000).default(10_000),
  maxCostMicros: z.number().int().min(0).max(1_000_000_000).default(1_000_000),
  maxRetries: z.number().int().min(0).max(5).default(2),
}).strict();
export type JobLimits = z.infer<typeof Limits>;
export const SmokeInput = z.object({
  delayMs: z.number().int().min(0).max(60_000).default(100),
  tokensPerStage: z.number().int().min(0).max(1_000_000).default(10),
  costMicrosPerStage: z.number().int().min(0).max(1_000_000).default(100),
  transientFailures: z.number().int().min(0).max(6).default(0),
}).strict();
export type Smoke = z.infer<typeof SmokeInput>;
export const ProjectInput = z.object({ name: z.string().trim().min(1).max(160),
  siteType: z.enum(['wordpress', 'nextjs']).default('wordpress') }).strict();
export const Requirement = z.object({ key: z.string().regex(/^[a-z0-9-]{1,80}$/),
  description: z.string().trim().min(1).max(2000), required: z.boolean().default(true) }).strict();
export const JobInput = z.object({
  projectId: Id,
  pipeline: z.literal('controller-smoke-v1'),
  input: SmokeInput.default({ delayMs: 100, tokensPerStage: 10, costMicrosPerStage: 100, transientFailures: 0 }),
  limits: Limits.default({ maxRuntimeMs: 60_000, stageTimeoutMs: 15_000, maxTokens: 10_000, maxCostMicros: 1_000_000, maxRetries: 2 }),
  requirements: z.array(Requirement).max(100).default([]),
}).strict();
export type NewJob = z.infer<typeof JobInput>;
export const ResumeInput = z.object({ limits: Limits }).strict();
export const STAGES = ['prepare', 'checkpoint', 'finalize'] as const;
export type StageName = typeof STAGES[number];
export type JobStatus = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed' | 'needs_review';

/** Implemented provider boundary; actual usage can have unknown monetary cost. */
export type {AgentTask as ProviderTask,ProviderOutcome as ProviderResult,ProviderAdapter} from './agent-contracts.js';
export interface ToolPolicy {
  workspaceId: string;
  writablePaths: string[];
  networkHosts: string[];
  tools: Array<'read' | 'edit' | 'browser' | 'shell'>;
  productionAccess: false;
  hostDockerAccess: false;
}
export interface ArtifactReference {
  id: string;
  sha256: string;
  mediaType: string;
  bytes: number;
  candidateRevision: string | null;
}
