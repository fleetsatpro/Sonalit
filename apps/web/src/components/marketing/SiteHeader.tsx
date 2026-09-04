import { NAV_LINKS } from './nav.js';

/**
 * Public site header. Plain <a> elements rather than router <Link>s: the
 * marketing pages are prerendered to static HTML, so every link has to work
 * before (and without) the application bundle executes — which is also what a
 * crawler sees. The mobile menu is a <details> disclosure so it needs no
 * JavaScript and is keyboard operable by default.
 */
export default function SiteHeader({ currentPath }: { currentPath: string }): React.ReactElement {
  return (
    <header className="sticky top-0 z-50 border-b border-d-rim bg-d-void/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 lg:px-8">
        <a
          href="/"
          className="flex items-center gap-2.5 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cds-orange"
          aria-label="Sonalit home"
        >
          <img
            src="/icon-192.png"
            alt=""
            width={28}
            height={28}
            className="h-7 w-7 rounded-md"
            aria-hidden="true"
          />
          <span className="text-[17px] font-bold tracking-[0.14em] text-d-t1">SONALIT</span>
        </a>

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={currentPath === link.href ? 'page' : undefined}
              className={
                `rounded-md px-3 py-2 text-[13.5px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cds-orange ${ 
                currentPath === link.href
                  ? 'text-cds-orange'
                  : 'text-d-t2 hover:bg-white/[0.04] hover:text-d-t1'}`
              }
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href="/login"
            className="hidden rounded-md border border-d-rim2 px-4 py-2 text-[13.5px] font-semibold text-d-t1 transition-colors hover:border-cds-orange hover:text-cds-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cds-orange sm:inline-block"
          >
            Sign in
          </a>
          <details className="group relative lg:hidden">
            <summary
              className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-md border border-d-rim2 text-d-t1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cds-orange"
              aria-label="Open navigation menu"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
              </svg>
            </summary>
            <nav
              aria-label="Primary mobile"
              className="absolute right-0 top-12 w-64 rounded-lg border border-d-rim2 bg-d-deep p-2 shadow-2xl"
            >
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  aria-current={currentPath === link.href ? 'page' : undefined}
                  className="block rounded-md px-3 py-2.5 text-sm font-medium text-d-t1 hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cds-orange"
                >
                  {link.label}
                </a>
              ))}
              <a
                href="/login"
                className="mt-1 block rounded-md bg-cds-orange px-3 py-2.5 text-center text-sm font-semibold text-[#170900] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cds-orange"
              >
                Sign in to Sonalit
              </a>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
