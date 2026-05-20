import { connect, type NatsConnection, type JetStreamClient, type JetStreamManager, RetentionPolicy, StorageType, AckPolicy } from 'nats';
import { config } from './config.js';

let nc: NatsConnection;
let js: JetStreamClient;

export async function connectNats(): Promise<void> {
  nc = await connect({ servers: config.NATS_URL });
  const jsm: JetStreamManager = await nc.jetstreamManager();

  const streams = await jsm.streams.list().next();
  const exists = streams.some((s) => s.config.name === 'TELEMETRY');

  if (!exists) {
    await jsm.streams.add({
      name: 'TELEMETRY',
      subjects: ['telemetry.gps.>'],
      retention: RetentionPolicy.Limits,
      storage: StorageType.File,
      max_age: 7 * 24 * 60 * 60 * 1e9, // 7 days in nanoseconds
      max_bytes: 10 * 1024 * 1024 * 1024, // 10 GB
      num_replicas: 1,
      consumer_limits: {},
    });
  }

  js = nc.jetstream();
}

export function getJs(): JetStreamClient {
  if (!js) throw new Error('NATS not connected');
  return js;
}

export function getNc(): NatsConnection {
  if (!nc) throw new Error('NATS not connected');
  return nc;
}

export async function isNatsReady(): Promise<boolean> {
  try {
    if (!nc) return false;
    return !nc.isClosed();
  } catch {
    return false;
  }
}

export async function closeNats(): Promise<void> {
  await nc?.drain();
}
