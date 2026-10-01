import { Pool, type PoolClient } from 'pg';
import { config } from './config.js';

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
}

export async function query<T extends object = object>(
  text: string,
  values?: unknown[],
): Promise<T[]> {
  const res = await pool.query<T>(text, values);
  return res.rows;
}

export async function queryOne<T extends object = object>(
  text: string,
  values?: unknown[],
): Promise<T | null> {
  const res = await pool.query<T>(text, values);
  return res.rows[0] ?? null;
}
