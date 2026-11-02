import { cp } from 'node:fs/promises';
await cp(new URL('../src/migrations', import.meta.url), new URL('../dist/controller/migrations', import.meta.url), { recursive: true });
