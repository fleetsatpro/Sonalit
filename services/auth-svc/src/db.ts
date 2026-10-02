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

pool.on('error', (_err: Error) => {
  // errors forwarded to pino logger in index.ts
});

export async function withOrgContext<T>(
  orgId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    // SET LOCAL only takes effect inside an explicit transaction block.
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE sonalit_app');
    await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function query<T extends object = object>(
  text: string,
  values?: unknown[]
): Promise<T[]> {
  const orgId = tenantContext.getStore();
  if (!orgId) throw new Error('tenant_scope_required: use globalQuery() only for explicit bootstrap/system operations');
  return withOrgContext(orgId, client => client.query<T>(text, values)).then(r => r.rows);
}

export async function globalQuery<T extends object = object>(
  text: string,
  values?: unknown[]
): Promise<T[]> {
  if (tenantContext.getStore()) throw new Error('global_query_forbidden_inside_tenant_context');
  const result = await pool.query<T>(text, values);
  return result.rows;
}
