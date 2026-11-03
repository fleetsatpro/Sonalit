/**
 * Canonical identity of the public Sonalit website.
 *
 * Everything that is allowed to appear in crawlable metadata (canonical URLs,
 * Open Graph URLs, the sitemap, JSON-LD @id values) is derived from this one
 * origin. It is a hard-coded production constant on purpose: a preview
 * deployment must never advertise its own hostname as canonical, so this is
 * deliberately NOT read from an environment variable.
 */
export const SITE_ORIGIN = 'https://sonalit.com';

export const SITE_NAME = 'Sonalit';

/** 1200x630 social card served from apps/web/public/og/. */
export const OG_IMAGE_PATH = '/og/sonalit-og.png';

/**
 * Canonical URL convention: no trailing slash anywhere except the root.
 * vercel.json sets `trailingSlash: false`, so a request for `/about/` is
 * permanently redirected to `/about` — the sitemap, the canonical tag and the
 * live URL therefore always agree.
 */
export function canonicalUrl(path: string): string {
  if (path === '/' || path === '') return `${SITE_ORIGIN}/`;
  const clean = (`/${  path.replace(/^\/+/, '')}`).replace(/\/+$/, '');
  return SITE_ORIGIN + clean;
}

export function absoluteUrl(path: string): string {
  return path.startsWith('http') ? path : SITE_ORIGIN + (path.startsWith('/') ? path : `/${path}`);
}
