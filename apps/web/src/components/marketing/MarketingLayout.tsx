import Seo from '../seo/Seo.js';

import SiteFooter from './SiteFooter.js';
import SiteHeader from './SiteHeader.js';

import type { PageSeo } from '../../lib/seo/pages.js';

/**
 * Chrome shared by every public page: the fixed background layers, skip link,
 * header, <main> landmark, footer, and the page's head metadata.
 *
 * The .sonalit-public class is the scope every rule in styles/marketing.css
 * hangs off, so the public design system cannot leak into the operator app —
 * and the app's blanket font override cannot leak in here.
 *
 * Rendered both in the browser (via the router) and at build time by
 * scripts/prerender.tsx, so nothing in this subtree may touch window, the
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
    <div className="sonalit-public">
      <Seo page={page} />
      <div className="bg-base" aria-hidden="true" />
      <div className="bg-glow" aria-hidden="true" />
      <div className="bg-grid" aria-hidden="true" />

      <div className="page">
        <a href="#main" className="skip">
          Skip to main content
        </a>
        <SiteHeader currentPath={page.path} />
        <main id="main">{children}</main>
        <SiteFooter />
      </div>
    </div>
  );
}
