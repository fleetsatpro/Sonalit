import {
  connect,
  type NatsConnection,
  type JetStreamClient,
  type JetStreamManager,
  RetentionPolicy,
  StorageType,
} from 'nats';
import { config } from './config.js';

let nc: NatsConnection;
let js: JetStreamClient;

const STREAMS = [
  { name: 'COMMANDS', subjects: ['commands.>'] },
  { name: 'EVENTS', subjects: ['events.>'] },
  { name: 'AUDIT', subjects: ['audit.>'] },
];

export async function connectNats(): Promise<void> {
  nc = await connect({ servers: config.NATS_URL });
  const jsm: JetStreamManager = await nc.jetstreamManager();

  const existing = await jsm.streams.list().next();
  const existingNames = new Set(existing.map((s) => s.config.name));

  for (const stream of STREAMS) {
    if (!existingNames.has(stream.name)) {
      await jsm.streams.add({
        name: stream.name,
        subjects: stream.subjects,
        retention: RetentionPolicy.Limits,
        storage: StorageType.File,
        max_age: 30 * 24 * 60 * 60 * 1e9, // 30 days in nanoseconds
        num_replicas: 1,
      });
    }
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
    return nc != null && !nc.isClosed();
  } catch {
    return false;
  }
}

export async function closeNats(): Promise<void> {
  await nc?.drain();
}
