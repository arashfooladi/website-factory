import { Pool, type PoolClient } from 'pg';
import { readFile, readdir } from 'node:fs/promises';

export async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function migrate(pool: Pool): Promise<void> {
  await transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(73419401)');
    await client.query('CREATE SCHEMA IF NOT EXISTS factory');
    await client.query('CREATE TABLE IF NOT EXISTS factory.migrations(version integer PRIMARY KEY, applied_at timestamptz DEFAULT clock_timestamp())');
    const directory = new URL('./migrations/', import.meta.url);
    for (const file of (await readdir(directory)).filter(name => /^\d+_.*\.sql$/.test(name)).sort()) {
      const number = Number(file.split('_')[0]);
      const version = await client.query('SELECT 1 FROM factory.migrations WHERE version=$1', [number]);
      if (!version.rowCount) {
        await client.query(await readFile(new URL(file, directory), 'utf8'));
        await client.query('INSERT INTO factory.migrations(version) VALUES($1)', [number]);
      }
    }
  });
}
