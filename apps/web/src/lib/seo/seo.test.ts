import { describe, expect, it } from 'vitest';

import { buildHead } from './head.js';
import { PUBLIC_PAGES, getPageSeo, jsonLdFor } from './pages.js';
import { SITE_ORIGIN, canonicalUrl } from './site.js';

/**
 * The SEO registry is the contract between the runtime <Seo /> component, the
 * build-time prerenderer and the sitemap. These assertions are the checklist
 * that would otherwise be run by hand against production after every deploy.
 */
const PUBLIC_PATHS = [
  '/',
  '/fleet-management',
  '/convoy-management',
  '/container-delivery',
  '/security-operations',
  '/about',
  '/contact',
];

// Never indexable: these are authenticated application surfaces.
const PRIVATE_PATHS = [
  '/home',
  '/login',
  '/command',
  '/fleet',
  '/gps',
  '/convoys',
  '/alerts',
  '/reports',
  '/cds',
  '/handover',
  '/field/yard',
  '/portal/dashboard',
];

describe('public page registry', () => {
  it('covers exactly the intended public routes', () => {
    expect(PUBLIC_PAGES.map((p) => p.path).sort()).toEqual([...PUBLIC_PATHS].sort());
  });

  it('never registers an authenticated route', () => {
    const registered = new Set(PUBLIC_PAGES.map((p) => p.path));
    for (const path of PRIVATE_PATHS) expect(registered.has(path)).toBe(false);
  });

  it('gives every page a unique title and description', () => {
    const titles = PUBLIC_PAGES.map((p) => p.title);
    const descriptions = PUBLIC_PAGES.map((p) => p.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it('keeps descriptions inside the length Google renders', () => {
    for (const page of PUBLIC_PAGES) {
      expect(page.description.length, page.path).toBeGreaterThanOrEqual(120);
      expect(page.description.length, page.path).toBeLessThanOrEqual(170);
    }
  });

  it('mentions Sonalit in every title', () => {
    for (const page of PUBLIC_PAGES) expect(page.title).toContain('Sonalit');
  });
});

describe('canonical URLs', () => {
  it('uses the production origin with no trailing slash except the root', () => {
    expect(canonicalUrl('/')).toBe('https://sonalit.com/');
    expect(canonicalUrl('/about')).toBe('https://sonalit.com/about');
    expect(canonicalUrl('/about/')).toBe('https://sonalit.com/about');
  });

  it('never emits a development or preview host', () => {
    for (const page of PUBLIC_PAGES) {
      const head = buildHead(page);
      expect(head.canonical.startsWith(`${SITE_ORIGIN}/`)).toBe(true);
      for (const meta of head.metas) {
        expect(meta.content).not.toMatch(/localhost|vercel\.app|railway\.app|github\.com/);
      }
    }
  });
});

describe('head tags', () => {
  it('emits the full social and robots set for every page', () => {
    const required = [
      'description',
      'robots',
      'og:title',
      'og:description',
      'og:url',
      'og:type',
      'og:image',
      'twitter:card',
      'twitter:title',
      'twitter:description',
      'twitter:image',
    ];
    for (const page of PUBLIC_PAGES) {
      const keys = buildHead(page).metas.map((m) => m.name ?? m.property);
      for (const key of required) expect(keys, page.path).toContain(key);
    }
  });

  it('marks public pages indexable and points OG at an absolute image', () => {
    for (const page of PUBLIC_PAGES) {
      const metas = buildHead(page).metas;
      expect(metas.find((m) => m.name === 'robots')?.content).toContain('index');
      expect(metas.find((m) => m.property === 'og:image')?.content).toBe(
        'https://sonalit.com/og/sonalit-og.png',
      );
    }
  });
});

describe('structured data', () => {
  it('describes the organisation and website on the home page', () => {
    const types = jsonLdFor(getPageSeo('/')).map((b) => b['@type']);
    expect(types).toContain('Organization');
    expect(types).toContain('WebSite');
  });

  it('gives every inner page a breadcrumb back to the home page', () => {
    for (const page of PUBLIC_PAGES.filter((p) => p.path !== '/')) {
      const breadcrumb = jsonLdFor(page).find((b) => b['@type'] === 'BreadcrumbList');
      expect(breadcrumb, page.path).toBeDefined();
    }
  });

  it('is serialisable as valid JSON-LD', () => {
    for (const page of PUBLIC_PAGES) {
      for (const block of buildHead(page).jsonLd) {
        expect(JSON.parse(JSON.stringify(block))['@context']).toBe('https://schema.org');
      }
    }
  });
});
