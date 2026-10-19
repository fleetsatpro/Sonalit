import { StringCodec } from 'nats';
import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { getJs } from '../nats.js';

interface OutboxRow {
  id: string | number;
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
 * Delivery is at-least-once. Rows remain until JetStream acknowledges them.
 * A crash between broker ACK and DB commit can replay a message; consumers must be idempotent.
 */
export async function publishPendingOutboxBatch(batchSize = DEFAULT_BATCH_SIZE): Promise<{ published: number; deferred: number }> {
  const client: PoolClient = await pool.connect();
  let published = 0;
  let deferred = 0;
  try {
    await client.query('BEGIN');
    const selected = await client.query<OutboxRow>(
      `SELECT id, subject, payload, message_id, publish_attempts
         FROM telemetry_ingest_outbox
        WHERE next_attempt_at <= NOW()
        ORDER BY id LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [batchSize],
    );
    const failed: Array<{ row: OutboxRow; error: string }> = [];
    const deliveredIds: Array<string | number> = [];
    await Promise.all(selected.rows.map(async (row) => {
      try {
        await publishRow(row);
        deliveredIds.push(row.id);
      } catch (err) {
        failed.push({ row, error: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
      }
    }));
    if (deliveredIds.length) {
      await client.query(
        'DELETE FROM telemetry_ingest_outbox WHERE id = ANY($1::bigint[])',
        [deliveredIds.map(String)],
      );
      published = deliveredIds.length;
    }
    for (const item of failed) {
      const delaySeconds = Math.min(300, 2 ** Math.min(item.row.publish_attempts, 8));
      await client.query(
        `UPDATE telemetry_ingest_outbox
            SET publish_attempts = publish_attempts + 1,
                next_attempt_at = NOW() + ($2::int * INTERVAL '1 second'),
                last_error = $3
          WHERE id = $1`,
        [item.row.id, delaySeconds, item.error],
      );
      deferred++;
    }
    await client.query('COMMIT');
    return { published, deferred };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* preserve the original error */ }
    throw err;
  } finally {
    client.release();
  }
}

export function startOutboxPublisher(pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, batchSize = DEFAULT_BATCH_SIZE): () => Promise<void> {
  if (publisherActive) throw new Error('telemetry_outbox_publisher_already_started');
  publisherActive = true;
  let inFlight: Promise<void> | null = null;
  let stopped = false;
  const tick = (): void => {
    if (stopped || inFlight) return;
    inFlight = publishPendingOutboxBatch(batchSize)
      .then(({ published, deferred }) => {
        if (published || deferred) process.stdout.write(`[telemetry-outbox] published=${published} deferred=${deferred}\n`);
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
