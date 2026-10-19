import { StringCodec } from 'nats';
import type { PoolClient } from 'pg';
import { globalQuery, withOrgContext } from '../db.js';
import { getJs, isNatsReady } from '../nats.js';

interface OutboxCandidate {
  id: string | number;
  org_id: string;
}

interface OutboxRow extends OutboxCandidate {
  device_id: string;
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
  // Broker outages should not consume retry budget or take database locks.
  if (!(await isNatsReady())) return { published: 0, deferred: 0 };

  const candidates = await globalQuery<OutboxCandidate>(
    `SELECT candidate.id, candidate.org_id::text AS org_id
       FROM telemetry_ingest_outbox candidate
      WHERE candidate.next_attempt_at <= NOW()
        AND NOT EXISTS (
          SELECT 1
            FROM telemetry_ingest_outbox earlier
           WHERE earlier.org_id = candidate.org_id
             AND earlier.device_id = candidate.device_id
             AND earlier.id < candidate.id
             AND earlier.next_attempt_at > NOW()
        )
      ORDER BY candidate.id
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
      // Serialize dispatch within one tenant across replicas. SKIP LOCKED below
      // remains a second guard for any administrative worker using row claims.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('sonalit_telemetry_outbox:' || $1))",
        [orgId],
      );
      const selected = await client.query<OutboxRow>(
        `SELECT pending.id, pending.org_id::text AS org_id, pending.subject,
                pending.payload, pending.message_id, pending.publish_attempts,
                pending.device_id::text AS device_id
           FROM telemetry_ingest_outbox pending
          WHERE pending.org_id = $1
            AND pending.id = ANY($2::bigint[])
            AND pending.next_attempt_at <= NOW()
            AND NOT EXISTS (
              SELECT 1
                FROM telemetry_ingest_outbox earlier
               WHERE earlier.org_id = pending.org_id
                 AND earlier.device_id = pending.device_id
                 AND earlier.id < pending.id
                 AND earlier.next_attempt_at > NOW()
            )
          ORDER BY pending.id
          FOR UPDATE OF pending SKIP LOCKED`,
        [orgId, ids.map(String)],
      );

      let tenantPublished = 0;
      let tenantDeferred = 0;
      const blockedDevices = new Set<string>();
      // Publish each device's pending events in insertion order. If an earlier
      // message fails, leave later messages queued rather than letting consumers
      // observe a hole and then having to reconcile the device's event sequence.
      for (const row of selected.rows) {
        if (blockedDevices.has(row.device_id)) continue;
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
          blockedDevices.add(row.device_id);
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
