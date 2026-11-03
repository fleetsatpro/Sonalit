import BrandMark from './BrandMark.js';
import { NAV_LINKS } from './nav.js';

/**
 * Public site header.
 *
 * Plain <a> elements rather than router <Link>s: the marketing pages are
 * prerendered to static HTML, so every link has to work before (and without)
 * the application bundle executes — which is also what a crawler follows.
 *
 * The nav items point at the real service pages rather than in-page anchors,
 * so each one is a crawlable internal link with descriptive anchor text.
 *
 * Below 1080px the horizontal nav is replaced by a <details> disclosure: no
 * JavaScript, keyboard operable by default, and it means small screens still
 * have a way to reach every page.
 */
export default function SiteHeader({ currentPath }: { currentPath: string }): React.ReactElement {
  return (
    <nav className="nav" aria-label="Primary">
      <a href="/" className="logo" aria-label="Sonalit — home">
        <BrandMark />
      </a>

      <ul className="nav-links">
        {NAV_LINKS.map((link) => (
          <li key={link.href}>
            <a href={link.href} aria-current={currentPath === link.href ? 'page' : undefined}>
              {link.short}
            </a>
          </li>
        ))}
      </ul>

      <div className="nav-right">
        <a href="/login" className="btn btn-primary">
          Access Platform
        </a>

        <details className="nav-menu">
          <summary aria-label="Open navigation menu">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          </summary>
          <div className="nav-panel">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} aria-current={currentPath === link.href ? 'page' : undefined}>
                {link.label}
              </a>
            ))}
            <a href="/login" className="nav-panel-cta">
              Access Platform
            </a>
          </div>
        </details>
      </div>
    </nav>
  );
}
