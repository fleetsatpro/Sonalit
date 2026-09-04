import { Pool, type PoolClient } from 'pg';
import { config } from './config.js';

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 25,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

/**
 * Runs `fn` with PostgreSQL row-level security scoped to one tenant.
 *
 * Mirrors `backend/src/utils/orgScopedDb.js` withOrg(), which is the
 * platform's reference implementation. All three steps are load-bearing and
 * RLS is inert if any one is missing:
 *
 *  1. BEGIN — `SET LOCAL` outside a transaction block is a no-op that only
 *     emits a warning, so without this the org id is never actually set.
 *  2. SET LOCAL ROLE sonalit_app — table owners and superusers BYPASS RLS.
 *     The service connects via DATABASE_URL, typically as the owner, so
 *     policies do not apply until the role is dropped to a non-owner.
 *  3. app.current_org_id — the setting name every RLS policy in the
 *     platform reads. A different name (this previously used `app.org_id`)
 *     leaves policies evaluating NULL.
 *
 * Both settings are transaction-local, which is what makes this safe under
 * connection pooling: the scope cannot leak to the next borrower.
 */
export async function withOrgContext<T>(
  orgId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE sonalit_app');
    await client.query('SELECT set_config($1, $2, true)', ['app.current_org_id', orgId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // A rollback failure means the connection is already broken; the
      // original error is the one worth propagating.
    }
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

export interface AiDecision {
  id: string;
  org_id: string;
  user_id: string;
  query: string;
  response: string;
  created_at: Date;
}
