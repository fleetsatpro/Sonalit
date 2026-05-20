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
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`SET LOCAL app.org_id = $1`, [orgId]);
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function query<T extends object = object>(
  text: string,
  values?: unknown[]
): Promise<T[]> {
  const res = await pool.query<T>(text, values);
  return res.rows;
}
