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

export async function withOrgContext<T>(
  orgId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  return tenantContext.run(orgId, async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE sonalit_app');
    await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
  });
}

export async function query<T extends object = object>(
  text: string,
  values?: unknown[]
): Promise<T[]> {
  const orgId = tenantContext.getStore();
  if (orgId) return withOrgContext(orgId, client => client.query<T>(text, values)).then(r => r.rows);
  const res = await pool.query<T>(text, values);
  return res.rows;
}

export interface AiDecision {
  id: string;
  org_id: string;
  user_id: string;
  query: string;
  response: string;
  created_at: Date;
}
