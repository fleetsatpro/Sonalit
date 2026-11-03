/**
 * Last-known-good cache for the read side of the field flow.
 *
 * The write queue in offlineQueue.ts is only half of offline support: a
 * worker who can't load the booking list in a dead zone never reaches the
 * clamp form to queue anything. This keeps the last successful response for
 * the handful of field queries so the flow still opens with no signal.
 *
 * Deliberately hand-rolled rather than pulling in the TanStack persister
 * packages — three queries don't justify two new dependencies and a lockfile
 * change across the monorepo, and this way nothing is cached that we didn't
 * explicitly opt in.
 *
 * Network-first: a fresh response always wins and overwrites. The cache is
 * only ever read when the request itself failed.
 */

const PREFIX = 'sonalit-field-cache-v1:';

interface Entry<T> {
  data: T;
  at: number;
}

export function cacheWrite<T>(key: string, data: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, at: Date.now() } satisfies Entry<T>));
  } catch {
    // Quota/private mode — degrade to online-only rather than break the query.
  }
}

export function cacheRead<T>(key: string): Entry<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as Entry<T>;
  } catch {
    return null;
  }
}

/**
 * Wrap a queryFn so a failed request falls back to the last good response.
 *
 * Rethrows when there is no cache to fall back on, so a first-ever load with
 * no signal still surfaces the real error instead of rendering a silent
 * empty list that looks like "no work to do".
 */
export async function withOfflineFallback<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  try {
    const data = await fetcher();
    cacheWrite(key, data);
    return data;
  } catch (err) {
    const cached = cacheRead<T>(key);
    if (cached) return cached.data;
    throw err;
  }
}

/** Age of the cached copy in ms, or null if we've never stored one. */
export function cacheAge(key: string): number | null {
  const e = cacheRead(key);
  return e ? Date.now() - e.at : null;
}
