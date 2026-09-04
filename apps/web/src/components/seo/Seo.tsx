import { useEffect } from 'react';

import { buildHead } from '../../lib/seo/head.js';

import type { PageSeo } from '../../lib/seo/pages.js';

/**
 * Applies a public page's metadata to <head>.
 *
 * Every tag it manages carries data-seo="1". The build-time prerenderer emits
 * the same tags with the same marker, so on a prerendered page this hook finds
 * and updates the existing nodes instead of duplicating them; on a client-side
 * navigation between marketing pages it rewrites them in place; and on unmount
 * (entering the authenticated app) it removes them and restores the shell
 * title, so no operator screen inherits marketing metadata.
 *
 * Deliberately no dependency: react-helmet and friends would add a provider,
 * a runtime and a bundle for what four document API calls already do.
 */
const MARKER = 'data-seo';

function upsertMeta(key: 'name' | 'property', value: string, content: string): void {
  const selector = `meta[${key}="${CSS.escape(value)}"]`;
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(key, value);
    document.head.appendChild(el);
  }
  el.setAttribute(MARKER, '1');
  el.setAttribute('content', content);
}

export default function Seo({ page }: { page: PageSeo }): null {
  useEffect(() => {
    const head = buildHead(page);
    const previousTitle = document.title;

    document.title = head.title;
    for (const meta of head.metas) {
      if (meta.name) upsertMeta('name', meta.name, meta.content);
      else if (meta.property) upsertMeta('property', meta.property, meta.content);
    }

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute(MARKER, '1');
    canonical.setAttribute('href', head.canonical);

    document.head.querySelectorAll(`script[type="application/ld+json"][${MARKER}]`).forEach((n) => n.remove());
    for (const block of head.jsonLd) {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.setAttribute(MARKER, '1');
      script.textContent = JSON.stringify(block);
      document.head.appendChild(script);
    }

    return () => {
      document.head.querySelectorAll(`[${MARKER}]`).forEach((n) => n.remove());
      document.title = previousTitle;
    };
  }, [page]);

  return null;
}
