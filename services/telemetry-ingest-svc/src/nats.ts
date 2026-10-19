import { connect, type NatsConnection, type JetStreamClient, type JetStreamManager, RetentionPolicy, StorageType } from 'nats';
import { config } from './config.js';

let nc: NatsConnection | undefined;
let js: JetStreamClient | undefined;
let connectAttempt: Promise<void> | null = null;

export async function connectNats(): Promise<void> {
  if (nc && js && !nc.isClosed()) return;
  if (connectAttempt) return connectAttempt;

  const attempt = (async (): Promise<void> => {
    let candidate: NatsConnection | undefined;
    try {
      // Bound each initial attempt. HTTP ingestion can remain available while
      // durable GPS rows wait in PostgreSQL's outbox for JetStream recovery.
      candidate = await connect({ servers: config.NATS_URL, timeout: 3_000 });
      const jsm: JetStreamManager = await candidate.jetstreamManager();
      const streams = await jsm.streams.list().next();
      const exists = streams.some((s) => s.config.name === 'TELEMETRY');

      if (!exists) {
        await jsm.streams.add({
          name: 'TELEMETRY',
          subjects: ['telemetry.gps.>'],
          retention: RetentionPolicy.Limits,
          storage: StorageType.File,
          max_age: 7 * 24 * 60 * 60 * 1e9,
          max_bytes: 10 * 1024 * 1024 * 1024,
          num_replicas: 1,
          consumer_limits: {},
        });
      }

      // Publish the handles only after stream discovery/creation is successful.
      nc = candidate;
      js = candidate.jetstream();
    } catch (err) {
      if (candidate) {
        try { await candidate.close(); } catch { /* preserve the setup error */ }
      }
      throw err;
    }
  })();

  connectAttempt = attempt;
  try {
    await attempt;
  } finally {
    if (connectAttempt === attempt) connectAttempt = null;
  }
}

export function getJs(): JetStreamClient {
  if (!js || !nc || nc.isClosed()) throw new Error('NATS not connected');
  return js;
}

export function getNc(): NatsConnection {
  if (!nc || nc.isClosed()) throw new Error('NATS not connected');
  return nc;
}

export async function isNatsReady(): Promise<boolean> {
  try {
    return Boolean(nc && js && !nc.isClosed());
  } catch {
    return false;
  }
}

export async function closeNats(): Promise<void> {
  const connection = nc;
  nc = undefined;
  js = undefined;
  if (connection && !connection.isClosed()) await connection.drain();
}
