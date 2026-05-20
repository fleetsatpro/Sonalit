import { Centrifuge, type PublicationContext } from 'centrifuge';
import { useAuthStore } from '../stores/auth.js';

let client: Centrifuge | null = null;

export function getCentrifuge(): Centrifuge {
  if (!client) {
    client = new Centrifuge(import.meta.env['VITE_CENTRIFUGO_URL'] ?? 'wss://rt.sonalit.io/connection/websocket', {
      getToken: async () => {
        const token = useAuthStore.getState().token;
        if (!token) throw new Error('Not authenticated');
        return token;
      },
    });
    client.connect();
  }
  return client;
}

export function subscribe<T>(channel: string, handler: (data: T) => void): () => void {
  const c = getCentrifuge();
  const sub = c.newSubscription(channel, { recoverable: true });
  sub.on('publication', (ctx: PublicationContext) => handler(ctx.data as T));
  sub.subscribe();
  return () => { sub.unsubscribe(); sub.removeAllListeners(); };
}
