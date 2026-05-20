import { StringCodec } from 'nats';
import { getJs } from '../nats.js';
import { query } from '../db.js';
import { randomUUID, createHmac } from 'node:crypto';
import pino from 'pino';
const log = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

async function deliverWebhook(webhookId: string, url: string, secret: string, payload: unknown): Promise<void> {
  const body = JSON.stringify(payload);
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  const outboxId = randomUUID();
  await query('INSERT INTO outbox (id, webhook_id, payload, status) VALUES ($1,$2,$3,$4)', [outboxId, webhookId, body, 'pending']);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sonalit-Signature': sig }, body, signal: AbortSignal.timeout(10_000) });
    await query('UPDATE outbox SET status=$1, delivered_at=NOW() WHERE id=$2', [res.ok ? 'delivered' : 'failed', outboxId]);
  } catch {
    await query('UPDATE outbox SET status=\'failed\' WHERE id=$1', [outboxId]);
  }
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
      const { rows: webhooks } = await query<{ id: string; url: string; secret: string; events: string }>(
        'SELECT id, url, secret, events FROM webhooks WHERE org_id=$1 AND active=true AND deleted_at IS NULL',
        [event.org_id],
      );
      for (const wh of webhooks) {
        const events: string[] = JSON.parse(wh.events) as string[];
        if (events.includes('alert.new') || events.includes('*')) {
          void deliverWebhook(wh.id, wh.url, wh.secret, event);
        }
      }
      msg.ack();
    } catch (err) { log.error({ err }, 'Alerts consumer error'); msg.nak(); }
  }
}
