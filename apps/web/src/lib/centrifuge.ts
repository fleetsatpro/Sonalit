import { Centrifuge, type PublicationContext } from 'centrifuge';
import { api } from './api.js';

let client: Centrifuge | null = null;

async function fetchConnectionToken(): Promise<string> {
  const { data } = await api.post<{ token: string }>('/realtime/token');
  return data.token;
}

export function getCentrifuge(): Centrifuge {
  if (!client) {
    client = new Centrifuge(import.meta.env['VITE_CENTRIFUGO_URL'] ?? 'wss://rt.sonalit.io/connection/websocket', {
      getToken: fetchConnectionToken,
    });
    client.connect();
  }
  return client;
}

export function disconnectCentrifuge(): void {
  if (client) {
    client.disconnect();
    client = null;
  }
}

export function subscribe<T>(channel: string, handler: (data: T) => void): () => void {
  const c = getCentrifuge();
  const sub = c.newSubscription(channel, { recoverable: true });
  sub.on('publication', (ctx: PublicationContext) => handler(ctx.data as T));
  sub.subscribe();
  return () => { sub.unsubscribe(); sub.removeAllListeners(); };
}
