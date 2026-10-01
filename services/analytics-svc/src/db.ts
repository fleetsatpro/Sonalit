import { Pool, type PoolClient } from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from './config.js';

export const tenantContext = new AsyncLocalStorage<string>();

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 25,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function query<T extends object = object>(
  text: string,
  values?: unknown[],
): Promise<T[]> {
  const orgId = tenantContext.getStore();
  if (orgId) return withOrgContext(orgId, client => client.query<T>(text, values)).then(r => r.rows);
  const res = await pool.query<T>(text, values);
  return res.rows;
}
