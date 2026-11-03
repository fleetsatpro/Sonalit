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
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const currentOrg = tenantContext.getStore();
  if (currentOrg && currentOrg !== orgId) throw new Error('tenant_context_switch_forbidden');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE sonalit_app');
    await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
    const result = await tenantContext.run(orgId, () => fn(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

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
  if (!orgId) throw new Error(`analytics-svc tenant query attempted without tenant context: ${text.slice(0, 120)}`);
  return withOrgContext(orgId, client => client.query<T>(text, values)).then(r => r.rows);
}
