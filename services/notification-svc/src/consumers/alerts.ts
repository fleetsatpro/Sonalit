import { StringCodec } from 'nats';
import { getJs } from '../nats.js';
import { query } from '../db.js';
import { randomUUID, createHmac } from 'node:crypto';
import pino from 'pino';

const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

const MAX_DELIVERY_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 1_000;

async function deliverWithRetry(
  outboxId: string,
  webhookId: string,
  url: string,
  secret: string,
  payload: unknown,
): Promise<void> {
  const body = JSON.stringify(payload);
  const sig = createHmac('sha256', secret).update(body).digest('hex');

  for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sonalit-Signature': `sha256=${sig}`,
          'X-Sonalit-Delivery': outboxId,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        await query(
          `UPDATE outbox SET status='delivered', delivered_at=NOW(), attempts=$1 WHERE id=$2`,
          [attempt, outboxId],
        );
        return;
      }

      log.warn({ webhookId, url, status: res.status, attempt }, 'Webhook delivery non-OK response');
    } catch (err) {
      log.warn({ err, webhookId, url, attempt }, 'Webhook delivery error');
    }

    if (attempt < MAX_DELIVERY_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, BACKOFF_BASE_MS * Math.pow(2, attempt - 1)));
    }
  }

  await query(
    `UPDATE outbox SET status='failed', attempts=$1 WHERE id=$2`,
    [MAX_DELIVERY_ATTEMPTS, outboxId],
  );
}

export async function startAlertsConsumer(): Promise<void> {
  const js = getJs();
  const sc = StringCodec();
  const consumer = await js.consumers.get('EVENTS', 'notification-alerts');
  const messages = await consumer.consume();
  log.info('notification-svc alerts consumer started');

  for await (const msg of messages) {
    try {
      const event = JSON.parse(sc.decode(msg.data)) as { org_id: string; type: string };

      const webhooks = await query<{ id: string; url: string; secret: string; events: string }>(
        `SELECT id, url, secret, events
         FROM webhooks
         WHERE org_id=$1 AND active=true AND deleted_at IS NULL`,
        [event.org_id],
      );

      const deliveries: Promise<void>[] = [];
      for (const wh of webhooks) {
        const events: string[] = JSON.parse(wh.events) as string[];
        if (!events.includes('alert.new') && !events.includes('*')) continue;

        const outboxId = randomUUID();
        // Insert outbox row in same operation as the ack — ensures at-least-once delivery.
        await query(
          `INSERT INTO outbox (id, webhook_id, payload, status, attempts)
           VALUES ($1,$2,$3,'pending',0)`,
          [outboxId, wh.id, JSON.stringify(event)],
        );

        // Await delivery before acking the NATS message, so a crash before delivery
        // causes NATS to redeliver (idempotent due to outbox upsert).
        deliveries.push(deliverWithRetry(outboxId, wh.id, wh.url, wh.secret, event));
      }

      await Promise.allSettled(deliveries);
      msg.ack();
    } catch (err) {
      log.error({ err }, 'Alerts consumer error');
      msg.nak();
    }
  }
}
