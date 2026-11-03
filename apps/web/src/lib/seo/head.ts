import { jsonLdFor, type PageSeo } from './pages.js';
import { OG_IMAGE_PATH, SITE_NAME, absoluteUrl, canonicalUrl } from './site.js';

export interface MetaTag {
  /** Exactly one of name/property is set — the other stays undefined. */
  name?: string;
  property?: string;
  content: string;
}

export interface Head {
  title: string;
  canonical: string;
  metas: MetaTag[];
  /** Each entry is one <script type="application/ld+json"> body. */
  jsonLd: Record<string, unknown>[];
}

/**
 * The single source of head tags for a public page. Both the runtime <Seo />
 * component and the build-time prerenderer call this, so the tags a crawler
 * reads in the static HTML are byte-identical to the ones React would set.
 */
export function buildHead(page: PageSeo): Head {
  const url = canonicalUrl(page.path);
  const image = absoluteUrl(OG_IMAGE_PATH);
  const imageAlt = `${SITE_NAME} — fleet, convoy and container delivery operations platform`;

  return {
    title: page.title,
    canonical: url,
    metas: [
      { name: 'description', content: page.description },
      // Public marketing pages are the only indexable surface; the app routes
      // are noindex (see index.html / app-shell.html).
      { name: 'robots', content: 'index, follow, max-image-preview:large' },
      { property: 'og:site_name', content: SITE_NAME },
      { property: 'og:type', content: page.ogType ?? 'website' },
      { property: 'og:title', content: page.title },
      { property: 'og:description', content: page.description },
      { property: 'og:url', content: url },
      { property: 'og:image', content: image },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: imageAlt },
      { property: 'og:locale', content: 'en' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: page.title },
      { name: 'twitter:description', content: page.description },
      { name: 'twitter:image', content: image },
      { name: 'twitter:image:alt', content: imageAlt },
    ],
    jsonLd: jsonLdFor(page).map((block) => ({ '@context': 'https://schema.org', ...block })),
  };
}
