// NATS JetStream connection for the Watchtower consumer.
//
// Mirrors services/telemetry-ingest-svc/src/nats.ts, with one difference
// that matters: connecting is OPTIONAL here. Watchtower is an augmentation
// layer, so if NATS is unreachable the service must still serve Commander,
// RAG and the tool registry (Rule 3). Connection failure is logged and the
// AI plane starts without event ingestion.

import {
  connect,
  RetentionPolicy,
  StorageType,
  type JetStreamClient,
  type NatsConnection,
} from 'nats';

import { config } from './config.js';
import { WATCHTOWER_STREAM, WATCHTOWER_SUBJECTS } from './watchtower/consumer.js';

let nc: NatsConnection | null = null;
let js: JetStreamClient | null = null;

export async function connectNats(): Promise<JetStreamClient> {
  nc = await connect({ servers: config.NATS_URL });
  const jsm = await nc.jetstreamManager();

  const streams = await jsm.streams.list().next();
  if (!streams.some((s) => s.config.name === WATCHTOWER_STREAM)) {
    await jsm.streams.add({
      name: WATCHTOWER_STREAM,
      subjects: [...WATCHTOWER_SUBJECTS],
      retention: RetentionPolicy.Limits,
      storage: StorageType.File,
      // Watchtower correlates over minutes, but retention is measured in
      // days so a restart can replay recent history rather than starting
      // blind on an in-flight situation.
      max_age: 3 * 24 * 60 * 60 * 1e9,
      max_bytes: 2 * 1024 * 1024 * 1024,
      num_replicas: 1,
      consumer_limits: {},
    });
  }

  js = nc.jetstream();
  return js;
}

export function isNatsConnected(): boolean {
  return nc !== null && !nc.isClosed();
}

export async function closeNats(): Promise<void> {
  await nc?.drain();
  nc = null;
  js = null;
}
