import './otel.js';
import Fastify from 'fastify';
import { StringCodec, type JetStreamClient } from 'nats';
import { config } from './config.js';
import { connectNats, getJs, getNc, closeNats, AckPolicy, DeliverPolicy } from './nats.js';
import pino from 'pino';

const log = pino({ level: config.LOG_LEVEL });
const sc = StringCodec();

async function publishToCentrifugo(channel: string, data: unknown): Promise<void> {
  const res = await fetch(`${config.CENTRIFUGO_API_URL}/api/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `apikey ${config.CENTRIFUGO_API_KEY}`,
    },
    body: JSON.stringify({ channel, data }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) {
    log.warn({ channel, status: res.status }, 'Centrifugo publish non-OK');
  }
}

async function startTelemetryConsumer(js: JetStreamClient): Promise<void> {
  const consumer = await js.consumers.get('TELEMETRY', 'realtime-telemetry');
  const messages = await consumer.consume();
  log.info('Telemetry consumer started');
  void (async () => {
    for await (const msg of messages) {
      try {
        const fix = JSON.parse(sc.decode(msg.data)) as { org_id: string; device_id: string };
        await publishToCentrifugo(`org:${fix.org_id}:telemetry`, fix);
        msg.ack();
      } catch (err) {
        log.warn({ err }, 'Telemetry fan-out error');
        msg.nak();
      }
    }
  })();
}

async function startEventsConsumer(js: JetStreamClient): Promise<void> {
  const consumer = await js.consumers.get('EVENTS', 'realtime-events');
  const messages = await consumer.consume();
  log.info('Events consumer started');
  void (async () => {
    for await (const msg of messages) {
      try {
        const event = JSON.parse(sc.decode(msg.data)) as { org_id: string; type?: string };
        const channel = event.type === 'panic'
          ? `org:${event.org_id}:panic`
          : `org:${event.org_id}:events`;
        await publishToCentrifugo(channel, event);
        msg.ack();
      } catch (err) {
        log.warn({ err }, 'Events fan-out error');
        msg.nak();
      }
    }
  })();
}

async function startConvoyConsumer(js: JetStreamClient): Promise<void> {
  const consumer = await js.consumers.get('CONVOY', 'realtime-convoy');
  const messages = await consumer.consume();
  log.info('Convoy consumer started');
  void (async () => {
    for await (const msg of messages) {
      try {
        const update = JSON.parse(sc.decode(msg.data)) as { org_id: string };
        await publishToCentrifugo(`org:${update.org_id}:convoy`, update);
        msg.ack();
      } catch (err) {
        log.warn({ err }, 'Convoy fan-out error');
        msg.nak();
      }
    }
  })();
}

async function ensureConsumers(js: JetStreamClient): Promise<void> {
  const jsm = await getNc().jetstreamManager();

  const durable = (stream: string, name: string, filterSubject?: string) =>
    jsm.consumers.add(stream, {
      durable_name: name,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.New,
      ...(filterSubject ? { filter_subject: filterSubject } : {}),
    }).catch(() => { /* already exists */ });

  await durable('TELEMETRY', 'realtime-telemetry', 'telemetry.gps.>');
  await durable('EVENTS', 'realtime-events', 'events.>');
  await durable('CONVOY', 'realtime-convoy', 'convoy.updated.*');

  await startTelemetryConsumer(js);
  await startEventsConsumer(js);
  await startConvoyConsumer(js);
}

async function start(): Promise<void> {
  await connectNats();
  const js = getJs();
  await ensureConsumers(js);

  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

  app.get('/healthz', async (_req, reply) => {
    return reply.send({ status: 'ok', service: 'realtime-gateway-svc' });
  });

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  log.info({ port: config.PORT }, 'realtime-gateway-svc listening');

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'Graceful shutdown initiated');
    await app.close();
    await closeNats();
    process.exit(0);
  };

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
}

start().catch((err: Error) => {
  process.stderr.write(`Fatal startup error: ${err.message}\n`);
  process.exit(1);
});
