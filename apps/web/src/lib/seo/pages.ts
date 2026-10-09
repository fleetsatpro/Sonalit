import { SITE_NAME, SITE_ORIGIN, canonicalUrl } from './site.js';

/**
 * Single registry of every crawlable public page.
 *
 * Three consumers read it, which is the whole point of keeping one list:
 *   1. <Seo /> at runtime, so a client-side navigation rewrites the head;
 *   2. scripts/prerender.tsx, which bakes the same tags into static HTML at
 *      build time (social scrapers and non-JS crawlers never run our bundle);
 *   3. the sitemap writer in the same script.
 *
 * Adding a public page means adding it here — nothing else stays in sync by
 * hand. Authenticated application routes are deliberately absent: they are not
 * public, and robots.txt is a crawling hint, never the security boundary.
 */
export interface PageSeo {
  /** Canonical path, no trailing slash (root is exactly '/'). */
  path: string;
  title: string;
  description: string;
  /** Open Graph type — the marketing pages are all `website`. */
  ogType?: string;
  /** Sitemap hints. */
  priority: number;
  changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** Extra JSON-LD blocks emitted for this page, beyond the breadcrumb. */
  jsonLd?: Record<string, unknown>[];
  /** Breadcrumb label; omitted on the home page. */
  breadcrumb?: string;
}

const ORGANIZATION = {
  '@type': 'Organization',
  '@id': `${SITE_ORIGIN}/#organization`,
  name: SITE_NAME,
  url: `${SITE_ORIGIN}/`,
  logo: `${SITE_ORIGIN}/icon-512.png`,
  description:
    'Sonalit builds fleet, convoy and container delivery operations software for logistics and field-security teams.',
} as const;

const WEBSITE = {
  '@type': 'WebSite',
  '@id': `${SITE_ORIGIN}/#website`,
  name: SITE_NAME,
  url: `${SITE_ORIGIN}/`,
  publisher: { '@id': `${SITE_ORIGIN}/#organization` },
  inLanguage: 'en',
} as const;

export const PUBLIC_PAGES: PageSeo[] = [
  {
    path: '/',
    title: 'Sonalit | Fleet, Convoy & Logistics Operations Platform',
    description:
      'Sonalit unifies fleet, convoy, container custody and security operations with GPS tracking, route-risk intelligence, field coordination, incident response and evidence.',
    priority: 1.0,
    changefreq: 'weekly',
    jsonLd: [ORGANIZATION, WEBSITE],
  },
  {
    path: '/fleet-management',
    title: 'Fleet Management Platform | Sonalit',
    description:
      'Run fleet operations from live GPS and journey replay through vehicle, driver and device management, geofences, shifts, maintenance, fuel, claims and reporting.',
    breadcrumb: 'Fleet Management',
    priority: 0.9,
    changefreq: 'monthly',
  },
  {
    path: '/convoy-management',
    title: 'Convoy Management & Security Operations | Sonalit',
    description:
      'Plan and govern convoys with risk-ranked routes, time-aware corridor evaluation, CFO field coordination, seal integrity, evidence capture, alerts and daily operational reporting.',
    breadcrumb: 'Convoy Management',
    priority: 0.9,
    changefreq: 'monthly',
  },
  {
    path: '/container-delivery',
    title: 'Container Delivery System | Sonalit',
    description:
      'Run the Container Delivery System across bookings, containers, transporters, trips, e-lock events, yard and port field operations, AI-assisted intelligence, billing, analytics and proof of delivery.',
    breadcrumb: 'Container Delivery',
    priority: 0.9,
    changefreq: 'monthly',
  },
  {
    path: '/security-operations',
    title: 'Fleet & Security Operations | Sonalit',
    description:
      'Operate security as a response fabric: prioritised alerts, incidents, panic escalation, Guardian field safety, signal integrity, geofences, route risk, spatial intelligence, communications and reconstruction.',
    breadcrumb: 'Security Operations',
    priority: 0.9,
    changefreq: 'monthly',
  },
  {
    path: '/about',
    title: 'About Sonalit | Fleet & Logistics Operations Technology',
    description:
      'Sonalit connects movement, custody, security and spatial intelligence in one operational fabric, with dedicated control-room, field, Guardian, CDS and cargo-owner surfaces.',
    breadcrumb: 'About',
    priority: 0.6,
    changefreq: 'monthly',
  },
  {
    path: '/contact',
    title: 'Contact Sonalit | Fleet & Logistics Operations',
    description:
      'Contact Sonalit about fleet, convoy, container delivery, spatial intelligence or security operations, or request access to the operational platform.',
    breadcrumb: 'Contact',
    priority: 0.6,
    changefreq: 'monthly',
  },
];

export function getPageSeo(path: string): PageSeo {
  const normalised = path === '/' ? '/' : path.replace(/\/+$/, '');
  const page = PUBLIC_PAGES.find((p) => p.path === normalised);
  if (!page) throw new Error(`No public page metadata registered for "${path}"`);
  return page;
}

/** JSON-LD blocks for a page: its own graph plus a breadcrumb where it has one. */
export function jsonLdFor(page: PageSeo): Record<string, unknown>[] {
  const blocks = [...(page.jsonLd ?? [])];
  if (page.breadcrumb) {
    blocks.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE_ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: page.breadcrumb, item: canonicalUrl(page.path) },
      ],
    });
  }
  return blocks;
}
