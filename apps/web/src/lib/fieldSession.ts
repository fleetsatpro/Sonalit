/**
 * Credential storage for the Sonalit Field app.
 *
 * Deliberately dependency-free so both the field screens and the shared CDS
 * axios client can read it without either importing the other.
 *
 * Two credentials, two lifetimes, and neither is a cookie — which is what
 * keeps a Field session and an operator session from being able to end or
 * read each other:
 *
 *   Device token  — localStorage. It identifies the tablet, not a person, and
 *                   it has to survive the OS killing the WebView, otherwise a
 *                   yard crew would be re-typing a pairing code every morning.
 *                   It is useless on its own: every data route also demands a
 *                   worker session, and an admin can revoke it centrally.
 *
 *   Session token — memory + sessionStorage. Scoped to the tab, so a reload
 *                   mid-shift doesn't cost the worker their place, but closing
 *                   the app hands the next crew a locked device rather than
 *                   whoever's account was left open. Not localStorage, and not
 *                   alongside the device token, precisely so the durable half
 *                   of the pair can never on its own act as a person.
 */
const DEVICE_KEY = 'sonalit-field-device-v1';
const SESSION_KEY = 'sonalit-field-session-v1';

let sessionToken: string | null = null;

function safeGet(store: Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    // Private mode / disabled storage — the app still works for this tab.
    return null;
  }
}

function safeSet(store: Storage | undefined, key: string, value: string | null): void {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, value);
  } catch {
    /* see above */
  }
}

export function getFieldDeviceToken(): string | null {
  if (typeof window === 'undefined') return null;
  return safeGet(window.localStorage, DEVICE_KEY);
}

export function setFieldDeviceToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  safeSet(window.localStorage, DEVICE_KEY, token);
}

export function getFieldSessionToken(): string | null {
  if (sessionToken) return sessionToken;
  if (typeof window === 'undefined') return null;
  sessionToken = safeGet(window.sessionStorage, SESSION_KEY);
  return sessionToken;
}

export function setFieldSessionToken(token: string | null): void {
  sessionToken = token;
  if (typeof window === 'undefined') return;
  safeSet(window.sessionStorage, SESSION_KEY, token);
}

/** True when this tab is acting as a signed-in field worker. */
export function hasFieldSession(): boolean {
  return Boolean(getFieldSessionToken() && getFieldDeviceToken());
}

/**
 * Headers for any request that should be answered as the Field app.
 * Returns an empty object when there is no field session, so callers can spread
 * it unconditionally and fall through to whatever auth they normally use.
 */
export function fieldAuthHeaders(): Record<string, string> {
  const device = getFieldDeviceToken();
  const session = getFieldSessionToken();
  if (!device || !session) return {};
  return { 'X-Field-Device': device, 'X-Field-Token': session };
}

/**
 * Fired when the server rejects a field session, so the field app can drop to
 * its PIN screen. It travels over the window rather than a direct call because
 * the code that detects it (the shared CDS axios client) also serves the
 * operator dashboard and must not depend on the field app.
 */
export const FIELD_SESSION_EXPIRED_EVENT = 'sonalit:field-session-expired';

export function announceFieldSessionExpired(): void {
  setFieldSessionToken(null);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(FIELD_SESSION_EXPIRED_EVENT));
  }
}
