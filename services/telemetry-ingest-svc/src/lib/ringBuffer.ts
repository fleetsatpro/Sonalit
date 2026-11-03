import { StringCodec, type JetStreamClient } from 'nats';

interface BufferedMessage {
  subject: string;
  payload: string;
  msgId: string;
}

const MAX_CAPACITY = 10_000;
const buffer: BufferedMessage[] = [];
let draining = false;

export function enqueueMessage(subject: string, payload: string, msgId: string): void {
  if (buffer.length >= MAX_CAPACITY) {
    buffer.shift();
  }
  buffer.push({ subject, payload, msgId });
}

export function bufferSize(): number {
  return buffer.length;
}

export async function drainBuffer(js: JetStreamClient): Promise<void> {
  if (draining || buffer.length === 0) return;
  draining = true;

  const sc = StringCodec();

  try {
    while (buffer.length > 0) {
      const msg = buffer[0]!;
      await js.publish(msg.subject, sc.encode(msg.payload), {
        msgID: msg.msgId,
      });
      buffer.shift();
    }
  } finally {
    draining = false;
  }
}
