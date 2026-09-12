import { relatedLinks, type NavLink } from './nav.js';

/** Section heading block: eyebrow label, title, supporting line. */
export function SectionHeading({
  id,
  label,
  title,
  desc,
}: {
  id: string;
  label?: string;
  title: string;
  desc?: string;
}): React.ReactElement {
  return (
    <>
      {label ? <div className="section-label">{label}</div> : null}
      <h2 id={id} className="section-title">
        {title}
      </h2>
      {desc ? <p className="section-desc">{desc}</p> : null}
    </>
  );
}

/** One capability card in the four-up grid. */
export function CapCard({ link }: { link: NavLink }): React.ReactElement {
  return (
    <article className="cap">
      <div className="cap-icon" aria-hidden="true">
        {link.icon}
      </div>
      <h3>{link.label}</h3>
      <p>{link.blurb}</p>
      <a className="cap-link" href={link.href}>
        Explore {link.label.toLowerCase()} <span aria-hidden="true">→</span>
      </a>
    </article>
  );
}

/**
 * A feature block: copy on one side, an ops visual on the other.
 *
 * `flip` puts the visual first on wide screens. On narrow screens the visual
 * always comes first regardless (see marketing.css), so the reading order stays
 * consistent rather than alternating.
 */
export function FeatureBlock({
  title,
  body,
  points,
  visual,
  visualLabel,
  flip = false,
}: {
  title: string;
  body: string;
  points: string[];
  visual: React.ReactNode;
  visualLabel: string;
  flip?: boolean;
}): React.ReactElement {
  const copy = (
    <div className="feat-copy">
      <h3>{title}</h3>
      <p>{body}</p>
      <ul className="feat-list">
        {points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </div>
  );
  const figure = (
    <div className="feat-visual">
      {visual}
      <div className="feat-visual-label">
        <span className="live" aria-hidden="true" />
        {visualLabel}
      </div>
    </div>
  );

  return (
    <div className="feat">
      {flip ? figure : copy}
      {flip ? copy : figure}
    </div>
  );
}

export function CtaBand({
  title,
  body,
  primaryHref = '/login',
  primaryLabel = 'Access Sonalit Platform',
  secondaryHref = '/contact',
  secondaryLabel = 'Request platform access',
}: {
  title: string;
  body: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}): React.ReactElement {
  return (
    <div className="cta-wrap">
      <section className="cta" aria-labelledby="cta-heading">
        <h2 id="cta-heading">{title}</h2>
        <p>{body}</p>
        <div className="cta-actions">
          <a href={primaryHref} className="btn btn-primary btn-lg">
            {primaryLabel}
          </a>
          <a href={secondaryHref} className="btn btn-ghost btn-lg">
            {secondaryLabel}
          </a>
        </div>
      </section>
    </div>
  );
}

/** Descriptive cross-links to the rest of the public site. */
export function RelatedPages({ currentPath }: { currentPath: string }): React.ReactElement {
  return (
    <section className="section" aria-labelledby="related-heading">
      <SectionHeading
        id="related-heading"
        label="Continue"
        title="Explore the rest of the platform"
      />
      <div className="cap-grid cap-grid-3">
        {relatedLinks(currentPath).map((link) => (
          <CapCard key={link.href} link={link} />
        ))}
      </div>
    </section>
  );
}
