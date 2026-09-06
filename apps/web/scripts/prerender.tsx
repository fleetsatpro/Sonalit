/**
 * Build-time static generation for the public marketing pages.
 *
 * Sonalit is a client-rendered SPA, which is fine for an authenticated
 * operations console but not for a public website: social scrapers never run
 * JavaScript at all, and relying on a crawler's renderer for the entire page
 * body is a bet with no upside. This script renders the seven public routes to
 * static HTML after `vite build`, so:
 *
 *   • GET /fleet-management returns the real page, not an empty <div id="root">
 *   • the canonical/OG/Twitter/JSON-LD tags are in the response bytes
 *   • the SPA still hydrates on top and takes over navigation
 *
 * It is deliberately NOT SSR: nothing runs per request, there is no server, and
 * the authenticated application is untouched. Run via `pnpm prerender` (which
 * `pnpm build` chains after `vite build`).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// tsx compiles this file with the classic JSX transform, so React has to be
// in scope even though the application itself uses the automatic runtime.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildHead } from '../src/lib/seo/head.js';
import { PUBLIC_PAGES, type PageSeo } from '../src/lib/seo/pages.js';
import { canonicalUrl } from '../src/lib/seo/site.js';

import About from '../src/pages/public/About.js';
import Contact from '../src/pages/public/Contact.js';
import ContainerDelivery from '../src/pages/public/ContainerDelivery.js';
import ConvoyManagement from '../src/pages/public/ConvoyManagement.js';
import FleetManagement from '../src/pages/public/FleetManagement.js';
import Home from '../src/pages/public/Home.js';
import SecurityOperations from '../src/pages/public/SecurityOperations.js';

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(WEB_ROOT, 'dist');

const COMPONENTS: Record<string, () => React.ReactElement> = {
  '/': Home,
  '/fleet-management': FleetManagement,
  '/convoy-management': ConvoyManagement,
  '/container-delivery': ContainerDelivery,
  '/security-operations': SecurityOperations,
  '/about': About,
  '/contact': Contact,
};

function fail(message: string): never {
  console.error(`\n[prerender] ${message}\n`);
  process.exit(1);
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `</script>` inside JSON-LD would close the block early. */
function escapeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * index.html and app-shell.html serve the public site and the application
 * respectively and must stay in lockstep (same CSP, same fonts, same entry
 * script). Drift is silent and only shows up in production, so it fails the
 * build here instead.
 */
function assertShellsInSync(): void {
  const normalise = (html: string): string =>
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^\s*<meta name="robots"[^>]*>\s*$/gm, '')
      .replace(/<title>[\s\S]*?<\/title>/, '')
      .replace(/\s+/g, ' ')
      .trim();

  const index = normalise(readFileSync(join(WEB_ROOT, 'index.html'), 'utf8'));
  const shell = normalise(readFileSync(join(WEB_ROOT, 'app-shell.html'), 'utf8'));
  if (index !== shell) {
    fail(
      'index.html and app-shell.html have diverged.\n' +
        'app-shell.html is the SPA fallback for the authenticated app and must stay a copy of\n' +
        'index.html apart from its comment header and its robots meta. Re-sync them and rebuild.',
    );
  }
}

function headHtml(page: PageSeo): string {
  const head = buildHead(page);
  const lines = [`<title>${escapeAttribute(head.title)}</title>`];
  for (const meta of head.metas) {
    const key = meta.name ? 'name' : 'property';
    const value = meta.name ?? meta.property ?? '';
    lines.push(
      `<meta ${key}="${escapeAttribute(value)}" content="${escapeAttribute(meta.content)}" data-seo="1" />`,
    );
  }
  lines.push(`<link rel="canonical" href="${escapeAttribute(head.canonical)}" data-seo="1" />`);
  for (const block of head.jsonLd) {
    lines.push(`<script type="application/ld+json" data-seo="1">${escapeJsonLd(block)}</script>`);
  }
  return lines.map((line) => `  ${line}`).join('\n');
}

function outputPath(routePath: string): string {
  return routePath === '/' ? join(DIST, 'index.html') : join(DIST, routePath.slice(1), 'index.html');
}

function renderPage(page: PageSeo, template: string): void {
  const Component = COMPONENTS[page.path];
  if (!Component) fail(`No component registered for public route "${page.path}"`);

  const markup = renderToStaticMarkup(<Component />);
  const html = template
    // vite-plugin-cesium injects a 5.8 MB blocking <script> and its stylesheet
    // into every HTML entry. The public pages never touch Cesium (the globe
    // lives behind authentication, on lazily loaded routes) and every link on
    // them is a real navigation, so a visitor who clicks through to /login
    // loads app-shell.html and gets Cesium there. Stripping it here is the
    // difference between a marketing page that loads and one that does not.
    .replace(/\s*<link rel="stylesheet" href="\/cesium\/[^"]*">/g, '')
    .replace(/\s*<script src="\/cesium\/[^"]*"><\/script>/g, '')
    // The public pages self-host Inter and Space Grotesk through the bundled
    // stylesheet (styles/marketing.css), so the app shell's Google Fonts
    // <link> is a render-blocking request to a third party that these pages
    // never use. The application keeps it — only the public HTML drops it.
    .replace(/\s*<link rel="preconnect" href="https:\/\/fonts\.(googleapis|gstatic)\.com"[^>]*>/g, '')
    .replace(/\s*<link href="https:\/\/fonts\.googleapis\.com[^"]*" rel="stylesheet"\s*\/?>/g, '')
    // The shell's own <title> (and any default description/robots meta) is
    // replaced wholesale by this page's head — never appended to, or the page
    // ships two titles and Google picks one at random.
    .replace(/\s*<meta name="description"[^>]*>/g, '')
    .replace(/\s*<meta name="robots"[^>]*>/g, '')
    .replace(/\s*<title>[\s\S]*?<\/title>/, `\n${headHtml(page)}`)
    .replace('<div id="root"></div>', `<div id="root">${markup}</div>`);

  const target = outputPath(page.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, html, 'utf8');
  console.log(`[prerender] ${page.path} -> ${target.replace(`${DIST}/`, 'dist/')}`);
}

function writeSitemap(): void {
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = PUBLIC_PAGES.map(
    (page) =>
      '  <url>\n' +
      `    <loc>${canonicalUrl(page.path)}</loc>\n` +
      `    <lastmod>${lastmod}</lastmod>\n` +
      `    <changefreq>${page.changefreq}</changefreq>\n` +
      `    <priority>${page.priority.toFixed(1)}</priority>\n` +
      '  </url>',
  ).join('\n');

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${urls}\n` +
    '</urlset>\n';

  writeFileSync(join(DIST, 'sitemap.xml'), xml, 'utf8');
  console.log(`[prerender] sitemap.xml -> ${PUBLIC_PAGES.length} public URLs`);
}

function main(): void {
  assertShellsInSync();

  // The template is app-shell.html, never dist/index.html: index.html is this
  // script's own output for '/', so reading it back would compound the
  // previous run's markup and head tags on a rebuild. app-shell.html is
  // written by vite on every build and never touched here, which also makes
  // running the prerender twice in a row produce identical files.
  let shell: string;
  try {
    shell = readFileSync(join(DIST, 'app-shell.html'), 'utf8');
  } catch {
    return fail('dist/app-shell.html not found — run `vite build` before prerendering.');
  }

  // Drop the shell's explanatory comment header; it is about the app shell and
  // has no business in a public page.
  const template = shell.replace(/^<!--[\s\S]*?-->\s*/, '');
  if (!template.includes('<div id="root"></div>')) {
    return fail('dist/app-shell.html has no empty <div id="root"></div> to render into.');
  }

  for (const page of PUBLIC_PAGES) renderPage(page, template);
  writeSitemap();
}

main();
