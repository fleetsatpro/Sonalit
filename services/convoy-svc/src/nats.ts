import { connect, type NatsConnection, type JetStreamClient } from 'nats';
import { config } from './config.js';

let nc: NatsConnection;
let js: JetStreamClient;

export async function connectNats(): Promise<void> {
  nc = await connect({ servers: config.NATS_URL });
  js = nc.jetstream();
}

export function getJs(): JetStreamClient {
  if (!js) throw new Error('NATS not connected');
  return js;
}

export async function closeNats(): Promise<void> {
  await nc?.drain();
}
