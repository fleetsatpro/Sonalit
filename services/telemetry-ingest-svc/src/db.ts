import { Pool } from 'pg';
import { config } from './config.js';

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err: Error) => {
  process.stderr.write(`Unexpected PostgreSQL pool error: ${err.message}\n`);
});

export async function query<T extends object = object>(
  text: string,
  values?: unknown[],
): Promise<T[]> {
  const res = await pool.query<T>(text, values);
  return res.rows;
}
