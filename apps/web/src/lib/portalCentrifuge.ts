/**
 * portalCentrifuge — Centrifugo client for cargo-portal clients.
 * Uses clientAuth (sonalit_client cookie) to get a connection token,
 * separate from the operator centrifuge connection in lib/centrifuge.ts.
 */
import { Centrifuge, type PublicationContext } from 'centrifuge';

const API = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';

let client: Centrifuge | null = null;

async function fetchPortalToken(): Promise<string> {
  const res = await fetch(`${API}/portal/auth/rt-token`, { credentials: 'include' });
  if (!res.ok) throw new Error('Realtime token unavailable');
  const json = await res.json() as { data: { token: string } };
  return json.data.token;
}

export function getPortalCentrifuge(): Centrifuge {
  if (!client) {
    client = new Centrifuge(
      (import.meta.env['VITE_CENTRIFUGO_URL'] as string | undefined) ?? 'wss://rt.sonalit.io/connection/websocket',
      { getToken: fetchPortalToken },
    );
    client.connect();
  }
  return client;
}

export function subscribePortal<T>(channel: string, handler: (data: T) => void): () => void {
  const c = getPortalCentrifuge();
  const sub = c.newSubscription(channel, { recoverable: true });
  sub.on('publication', (ctx: PublicationContext) => handler(ctx.data as T));
  sub.subscribe();
  return () => {
    sub.unsubscribe();
    sub.removeAllListeners();
    c.removeSubscription(sub);
  };
}
