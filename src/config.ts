import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';

const Schema = z.object({
  databaseUrl: z.string().startsWith('postgresql://'),
  apiToken: z.string().min(32),
  ownerId: z.uuid(),
  host: z.enum(['127.0.0.1', '::1']).default('127.0.0.1'),
  port: z.number().int().min(1024).max(65535).default(8790),
  leaseMs: z.number().int().min(500).max(60_000).default(15_000),
  pollMs: z.number().int().min(100).max(10_000).default(500),
  retryDelayMs: z.number().int().min(50).max(60_000).default(1000),
  artifactRoot: z.string().default('.runtime/controller/artifacts'),
  environmentRoot: z.string().default('.runtime/environments'),
  previewPortBase: z.number().int().min(9000).max(60000).default(9000),
  maxEnvironments: z.number().int().min(2).max(20).default(4),
  agentRoot:z.string().default('.runtime/agents'),
  referenceRoot:z.string().default('.runtime/references'),
  themeRoot:z.string().default('.runtime/themes'),
  designRoot:z.string().default('.runtime/design'),
  buildRoot:z.string().default('.runtime/builds'),
  functionalRoot:z.string().default('.runtime/functional'),
  visualRoot:z.string().default('.runtime/visual'),
  skillsetVersion:z.string().regex(/^v\d+$/).default('v2'),
  codexModel:z.string().regex(/^[a-zA-Z0-9._-]{1,120}$/).default('gpt-6.1-sol'),
  codexBinary:z.string().optional(),
  codexCredentialFile:z.string().default(resolve(homedir(),'.codex/auth.json')),
});
export type Config = z.infer<typeof Schema>;
export function parseConfig(raw: unknown): Config {
  const config = Schema.parse(raw);
  config.artifactRoot = resolve(config.artifactRoot);
  config.environmentRoot = resolve(config.environmentRoot);
  config.agentRoot = resolve(config.agentRoot);
  config.referenceRoot=resolve(config.referenceRoot);
  config.themeRoot=resolve(config.themeRoot);
  config.designRoot=resolve(config.designRoot);
  config.buildRoot=resolve(config.buildRoot);
  config.visualRoot=resolve(config.visualRoot);
  config.functionalRoot=resolve(config.functionalRoot);
  config.codexCredentialFile=resolve(config.codexCredentialFile);
  if(config.codexBinary)config.codexBinary=resolve(config.codexBinary);
  return config;
}
export async function loadConfig(): Promise<Config> {
  const file = process.env.FACTORY_CONFIG ?? '.runtime/controller/config.json';
  const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
  return parseConfig(raw);
}
