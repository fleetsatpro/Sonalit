import { COMPANY_LINKS, PLATFORM_LINKS } from './nav.js';

export default function SiteFooter(): React.ReactElement {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-d-rim bg-d-carbon">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
        <div className="sm:col-span-2 lg:col-span-2">
          <div className="flex items-center gap-2.5">
            <img src="/icon-192.png" alt="" width={26} height={26} className="h-[26px] w-[26px] rounded-md" aria-hidden="true" />
            <span className="text-[16px] font-bold tracking-[0.14em] text-d-t1">SONALIT</span>
          </div>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-d-t2">
            Sonalit is a multi-tenant operations platform for fleet, convoy and container delivery
            teams — live tracking, field coordination, incident response and operational reporting
            in one system.
          </p>
        </div>

        <nav aria-labelledby="footer-platform">
          <h2 id="footer-platform" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-d-t3">
            Platform
          </h2>
          <ul className="mt-4 space-y-2.5">
            {PLATFORM_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="text-sm text-d-t2 hover:text-cds-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cds-orange"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-labelledby="footer-company">
          <h2 id="footer-company" className="text-[11px] font-semibold uppercase tracking-[0.18em] text-d-t3">
            Company
          </h2>
          <ul className="mt-4 space-y-2.5">
            {COMPANY_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="text-sm text-d-t2 hover:text-cds-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cds-orange"
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <a
                href="/login"
                className="text-sm text-d-t2 hover:text-cds-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cds-orange"
              >
                Sign in to the operations platform
              </a>
            </li>
          </ul>
        </nav>
      </div>

      <div className="border-t border-d-rim">
        <div className="mx-auto max-w-7xl px-5 py-6 text-xs text-d-t3 lg:px-8">
          © {year} Sonalit. Fleet, convoy and container delivery operations technology.
        </div>
      </div>
    </footer>
  );
}
