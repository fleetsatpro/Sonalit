import BrandMark from './BrandMark.js';
import { COMPANY_LINKS, PLATFORM_LINKS } from './nav.js';

export default function SiteFooter(): React.ReactElement {
  const year = new Date().getFullYear();
  return (
    <footer>
      <div className="foot-grid">
        <div className="foot-brand">
          <a href="/" className="logo" aria-label="Sonalit — home">
            <BrandMark size={26} />
          </a>
          <p>Intelligent fleet, convoy and logistics operations platform.</p>
        </div>

        <div className="foot-links">
          <nav className="foot-col" aria-labelledby="foot-platform">
            <h2 id="foot-platform">Platform</h2>
            {PLATFORM_LINKS.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>

          <nav className="foot-col" aria-labelledby="foot-company">
            <h2 id="foot-company">Company</h2>
            {COMPANY_LINKS.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>

          <nav className="foot-col" aria-labelledby="foot-access">
            <h2 id="foot-access">Access</h2>
            <a href="/login">Sign in to Sonalit</a>
            <a href="/contact">Request platform access</a>
          </nav>
        </div>
      </div>

      <div className="foot-bottom">
        <span>© {year} Sonalit</span>
        <span className="foot-tag">Fleet · Convoy · Container delivery · Security operations</span>
      </div>
    </footer>
  );
}
