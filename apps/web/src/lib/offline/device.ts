/**
 * Stable per-device identity.
 *
 * Used for attribution (which tablet recorded this?) and for the server's
 * checkpoint bookkeeping. It is deliberately NOT a credential: the server never
 * authorises anything on the strength of this value, because a client-supplied
 * id is a claim, not an identity. Authorisation is the JWT or the field
 * device+PIN pair, exactly as before.
 *
 * Stored in localStorage rather than IndexedDB so it survives a database
 * version error, and so the very first sync — before the local DB is even
 * opened — can identify itself.
 */

const KEY = 'sonalit-device-id';

let cached: string | null = null;

function mint(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function getDeviceId(): string {
  if (cached) return cached;
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) {
      cached = existing;
      return existing;
    }
    const id = mint();
    localStorage.setItem(KEY, id);
    cached = id;
    return id;
  } catch {
    // Private mode or a locked-down WebView. A per-session id still gives the
    // server something to attribute this batch to; it just will not persist,
    // which costs checkpoint bookkeeping, not correctness — the authoritative
    // checkpoint is the one the device holds in its own database.
    cached = cached ?? mint();
    return cached;
  }
}

/** Test seam. */
export function _resetDeviceId(): void {
  cached = null;
}
