import {
  connect,
  type NatsConnection,
  type JetStreamClient,
  type JetStreamManager,
  RetentionPolicy,
  StorageType,
  AckPolicy,
  DeliverPolicy,
} from 'nats';
import { config } from './config.js';

let nc: NatsConnection;
let js: JetStreamClient;

const STREAMS = [
  {
    name: 'TELEMETRY',
    subjects: ['telemetry.gps.>'],
    max_age: 7 * 24 * 60 * 60 * 1e9,
  },
  {
    name: 'EVENTS',
    subjects: ['events.>'],
    max_age: 30 * 24 * 60 * 60 * 1e9,
  },
  {
    name: 'CONVOY',
    subjects: ['convoy.updated.*'],
    max_age: 90 * 24 * 60 * 60 * 1e9,
  },
  {
    name: 'MEDIA',
    subjects: ['media.committed.*'],
    max_age: 90 * 24 * 60 * 60 * 1e9,
  },
] as const;

async function ensureStream(
  jsm: JetStreamManager,
  name: string,
  subjects: readonly string[],
  max_age: number,
): Promise<void> {
  const streams = await jsm.streams.list().next();
  const exists = streams.some((s) => s.config.name === name);
  if (!exists) {
    await jsm.streams.add({
      name,
      subjects: [...subjects],
      retention: RetentionPolicy.Limits,
      storage: StorageType.File,
      max_age,
      num_replicas: 1,
    });
  }
}

export async function connectNats(): Promise<void> {
  nc = await connect({ servers: config.NATS_URL });
  const jsm: JetStreamManager = await nc.jetstreamManager();

  for (const stream of STREAMS) {
    await ensureStream(jsm, stream.name, stream.subjects, stream.max_age);
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

export { AckPolicy, DeliverPolicy };
