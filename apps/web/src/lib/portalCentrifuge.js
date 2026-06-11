/**
 * portalCentrifuge — Centrifugo client for cargo-portal clients.
 * Uses clientAuth (sonalit_client cookie) to get a connection token,
 * separate from the operator centrifuge connection in lib/centrifuge.ts.
 */
import { Centrifuge } from 'centrifuge';
const API = import.meta.env['VITE_API_BASE_URL'] ?? '/api/v1';
let client = null;
async function fetchPortalToken() {
    const res = await fetch(`${API}/portal/auth/rt-token`, { credentials: 'include' });
    if (!res.ok)
        throw new Error('Realtime token unavailable');
    const json = await res.json();
    return json.data.token;
}
export function getPortalCentrifuge() {
    if (!client) {
        client = new Centrifuge(import.meta.env['VITE_CENTRIFUGO_URL'] ?? 'wss://rt.sonalit.io/connection/websocket', { getToken: fetchPortalToken });
        client.connect();
    }
    return client;
}
export function subscribePortal(channel, handler) {
    const c = getPortalCentrifuge();
    const existing = c.getSubscription(channel);
    const sub = existing ?? c.newSubscription(channel, { recoverable: true });
    const pubHandler = (ctx) => handler(ctx.data);
    sub.on('publication', pubHandler);
    if (!existing)
        sub.subscribe();
    return () => {
        sub.off('publication', pubHandler);
        if (!existing) {
            sub.unsubscribe();
            sub.removeAllListeners();
            c.removeSubscription(sub);
        }
    };
}
