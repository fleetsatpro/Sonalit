import Seo from '../seo/Seo.js';

import SiteFooter from './SiteFooter.js';
import SiteHeader from './SiteHeader.js';

import type { PageSeo } from '../../lib/seo/pages.js';

/**
 * Chrome shared by every public page: skip link, header, <main> landmark,
 * footer, and the head metadata for the page.
 *
 * Rendered both in the browser (via the router) and at build time by
 * scripts/prerender.tsx — so nothing in this subtree may touch window, the
 * router context, or a CSS import at module scope.
 */
export default function MarketingLayout({
  page,
  children,
}: {
  page: PageSeo;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="min-h-dvh bg-d-void text-d-t1">
      <Seo page={page} />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-cds-orange focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#170900]"
      >
        Skip to main content
      </a>
      <SiteHeader currentPath={page.path} />
      <main id="main">{children}</main>
      <SiteFooter />
    </div>
  );
}
