import { relatedLinks } from './nav.js';

/** Small caps label above a heading — the site's section eyebrow. */
export function Eyebrow({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-cds-orange">{children}</p>
  );
}

export function Section({
  children,
  className = '',
  labelledBy,
  tone = 'void',
}: {
  children: React.ReactNode;
  className?: string;
  labelledBy?: string;
  tone?: 'void' | 'carbon' | 'deep';
}): React.ReactElement {
  const bg = tone === 'carbon' ? 'bg-d-carbon' : tone === 'deep' ? 'bg-d-deep' : 'bg-d-void';
  return (
    <section aria-labelledby={labelledBy} className={`${bg} border-t border-d-rim ${className}`}>
      <div className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-24">{children}</div>
    </section>
  );
}

export function SectionHeading({
  id,
  eyebrow,
  title,
  lede,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  lede?: string;
}): React.ReactElement {
  return (
    <div className="max-w-3xl">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 id={id} className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-d-t1 sm:text-[34px]">
        {title}
      </h2>
      {lede ? <p className="mt-5 text-[16.5px] leading-relaxed text-d-t2">{lede}</p> : null}
    </div>
  );
}

export function FeatureCard({
  title,
  body,
}: {
  title: string;
  body: string;
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-d-rim bg-d-deep/70 p-6 transition-colors hover:border-d-rim2">
      <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-d-t1">{title}</h3>
      <p className="mt-3 text-[14.5px] leading-relaxed text-d-t2">{body}</p>
    </div>
  );
}

export function FeatureGrid({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

/** Bulleted capability list — used on the service pages. */
export function CapabilityList({ items }: { items: string[] }): React.ReactElement {
  return (
    <ul className="mt-8 grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-[14.5px] leading-relaxed text-d-t2">
          <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-cds-orange" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function CtaBand({
  title,
  body,
  primaryHref = '/login',
  primaryLabel = 'Sign in to Sonalit',
  secondaryHref = '/contact',
  secondaryLabel = 'Contact the Sonalit team',
}: {
  title: string;
  body: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}): React.ReactElement {
  return (
    <section aria-labelledby="cta-heading" className="border-t border-d-rim bg-d-carbon">
      <div className="mx-auto max-w-7xl px-5 py-20 lg:px-8">
        <div className="rounded-2xl border border-d-rim2 bg-gradient-to-br from-d-deep to-d-void p-8 sm:p-12">
          <h2 id="cta-heading" className="max-w-2xl text-[26px] font-bold leading-tight tracking-[-0.02em] text-d-t1 sm:text-[32px]">
            {title}
          </h2>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-d-t2">{body}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={primaryHref}
              className="rounded-md bg-cds-orange px-5 py-3 text-[14.5px] font-semibold text-[#170900] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cds-orange"
            >
              {primaryLabel}
            </a>
            <a
              href={secondaryHref}
              className="rounded-md border border-d-rim2 px-5 py-3 text-[14.5px] font-semibold text-d-t1 transition-colors hover:border-cds-orange hover:text-cds-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cds-orange"
            >
              {secondaryLabel}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Descriptive cross-links to the other public pages. */
export function RelatedPages({ currentPath }: { currentPath: string }): React.ReactElement {
  const links = relatedLinks(currentPath);
  return (
    <Section labelledBy="related-heading" tone="void">
      <h2 id="related-heading" className="text-[22px] font-bold tracking-[-0.02em] text-d-t1">
        Continue exploring the Sonalit platform
      </h2>
      <div className="mt-8 grid gap-5 sm:grid-cols-3">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="group rounded-xl border border-d-rim bg-d-deep/70 p-6 transition-colors hover:border-cds-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cds-orange"
          >
            <h3 className="text-[15px] font-semibold text-d-t1 group-hover:text-cds-orange">{link.label}</h3>
            <p className="mt-2.5 text-[14px] leading-relaxed text-d-t2">{link.blurb}</p>
          </a>
        ))}
      </div>
    </Section>
  );
}
