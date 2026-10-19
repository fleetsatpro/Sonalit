import { StringCodec } from 'nats';
import type { PoolClient } from 'pg';
import { globalQuery, withOrgContext } from '../db.js';
import { getJs } from '../nats.js';

interface OutboxCandidate {
  id: string | number;
  org_id: string;
}

interface OutboxRow extends OutboxCandidate {
  subject: string;
  payload: unknown;
  message_id: string;
  publish_attempts: number;
}

const codec = StringCodec();
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_POLL_INTERVAL_MS = 200;
let publisherActive = false;

async function publishRow(row: OutboxRow): Promise<void> {
  const payload = typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload);
  await getJs().publish(row.subject, codec.encode(payload), { msgID: row.message_id });
}

/**
 * Delivery is at-least-once. A privileged global query selects only due row
 * identities for scheduling; each payload read/mutation runs under the owning
 * tenant's sonalit_app role and row-level-security context. Rows are re-locked
 * with SKIP LOCKED because another publisher may claim a candidate meanwhile.
 */
export async function publishPendingOutboxBatch(
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<{ published: number; deferred: number }> {
  const candidates = await globalQuery<OutboxCandidate>(
    `SELECT id, org_id::text AS org_id
       FROM telemetry_ingest_outbox
      WHERE next_attempt_at <= NOW()
      ORDER BY next_attempt_at, id
      LIMIT $1`,
    [batchSize],
  );

  // Group candidates by tenant, then read payloads through that tenant's RLS role.
  const byOrg = new Map<string, Array<string | number>>();
  for (const candidate of candidates) {
    const ids = byOrg.get(candidate.org_id) ?? [];
    ids.push(candidate.id);
    byOrg.set(candidate.org_id, ids);
  }

  let published = 0;
  let deferred = 0;

  for (const [orgId, ids] of byOrg) {
    const result = await withOrgContext(orgId, async (client: PoolClient) => {
      const selected = await client.query<OutboxRow>(
        `SELECT id, org_id::text AS org_id, subject, payload, message_id, publish_attempts
           FROM telemetry_ingest_outbox
          WHERE org_id = $1
            AND id = ANY($2::bigint[])
            AND next_attempt_at <= NOW()
          ORDER BY id
          FOR UPDATE SKIP LOCKED`,
        [orgId, ids.map(String)],
      );

      let tenantPublished = 0;
      let tenantDeferred = 0;
      // Keep per-tenant event order deterministic; parallel publishes can reorder
      // successive fixes before a downstream consumer observes them.
      for (const row of selected.rows) {
        try {
          await publishRow(row);
          await client.query(
            'DELETE FROM telemetry_ingest_outbox WHERE id = $1 AND org_id = $2',
            [row.id, orgId],
          );
          tenantPublished++;
        } catch (err) {
          const delaySeconds = Math.min(300, 2 ** Math.min(row.publish_attempts, 8));
          await client.query(
            `UPDATE telemetry_ingest_outbox
                SET publish_attempts = publish_attempts + 1,
                    next_attempt_at = NOW() + ($3::int * INTERVAL '1 second'),
                    last_error = $4
              WHERE id = $1 AND org_id = $2`,
            [row.id, orgId, delaySeconds, (err instanceof Error ? err.message : String(err)).slice(0, 500)],
          );
          tenantDeferred++;
        }
      }

      return { published: tenantPublished, deferred: tenantDeferred };
    });

    published += result.published;
    deferred += result.deferred;
  }

  return { published, deferred };
}

export function startOutboxPublisher(
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  batchSize = DEFAULT_BATCH_SIZE,
): () => Promise<void> {
  if (publisherActive) throw new Error('telemetry_outbox_publisher_already_started');
  publisherActive = true;
  let inFlight: Promise<void> | null = null;
  let stopped = false;

  const tick = (): void => {
    if (stopped || inFlight) return;
    inFlight = publishPendingOutboxBatch(batchSize)
      .then(({ published, deferred }) => {
        if (published || deferred) {
          process.stdout.write(`[telemetry-outbox] published=${published} deferred=${deferred}\n`);
        }
      })
      .catch((err: Error) => {
        process.stderr.write(`[telemetry-outbox] batch failed: ${err.message}\n`);
      })
      .finally(() => { inFlight = null; });
  };

  tick();
  const timer = setInterval(tick, pollIntervalMs);
  timer.unref?.();

  return async () => {
    stopped = true;
    clearInterval(timer);
    if (inFlight) await inFlight;
    publisherActive = false;
  };
}
