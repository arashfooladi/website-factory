import { z } from 'zod';
import { Id } from './contracts.js';

export const EnvironmentLimits = z.object({
  memoryMiB: z.number().int().min(512).max(4096).default(1024),
  tasks: z.number().int().min(64).max(256).default(128),
  cpuPercent: z.number().int().min(25).max(400).default(100),
  diskMiB: z.number().int().min(384).max(8192).default(1024),
  fileSizeMiB: z.number().int().min(64).max(512).default(128),
  ttlSeconds: z.number().int().min(300).max(86400).default(3600),
  retentionSeconds: z.number().int().min(0).max(604800).default(86400),
}).strict();
export const CreateEnvironment = z.object({ projectId: Id, themeBundleId:Id.optional(), limits: EnvironmentLimits.prefault({}) }).strict();
export type EnvironmentBudget = z.infer<typeof EnvironmentLimits>;
export type EnvironmentAction = 'create' | 'start' | 'stop' | 'destroy' | 'snapshot' | 'restore';
export interface EnvironmentRow {
  id: string; project_id: string; status: string; limits: EnvironmentBudget;
  preview_port: number; current_operation_id: string | null; expires_at: Date | null;
  retain_until: Date | null; reason: string | null;
  theme_bundle_id:string|null;
}
