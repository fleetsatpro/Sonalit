import MarketingLayout from '../../components/marketing/MarketingLayout.js';
import { PLATFORM_LINKS } from '../../components/marketing/nav.js';
import { CapCard, CtaBand, FeatureBlock, SectionHeading } from '../../components/marketing/ui.js';
import {
  ContainerVisual,
  ConvoyVisual,
  FleetVisual,
  OpsVisual,
} from '../../components/marketing/visuals.js';
import { getPageSeo } from '../../lib/seo/pages.js';

const PAGE = getPageSeo('/');

const LIFECYCLE = [
  {
    number: '01',
    title: 'Plan',
    body: 'Build the movement around its route, vehicles, cargo and operating rules before it leaves.',
    tone: 'fleet',
  },
  {
    number: '02',
    title: 'Move',
    body: 'Keep vehicles, journeys and container movements tied to the operational record as work happens.',
    tone: 'container',
  },
  {
    number: '03',
    title: 'Protect',
    body: 'Watch corridors, geofences, alerts and field activity from the same control surface.',
    tone: 'security',
  },
  {
    number: '04',
    title: 'Prove',
    body: 'Finish with the evidence: custody, checks, photos, delivery and incident history in sequence.',
    tone: 'convoy',
  },
];

export default function Home(): React.ReactElement {
  return (
    <MarketingLayout page={PAGE}>
      <header className="hero">
        <div className="hero-copy">
          <div className="hero-badge">
            <span className="hero-badge-index">01</span>
            Sonalit / Operations Platform
          </div>

          <p className="hero-kicker">CONTROL THE MOVEMENT. KEEP THE RECORD.</p>

          <h1>
            Fleet. Convoy.
            <br />
            <span className="accent-signal">Container.</span>{' '}
            <span className="serif-accent">One surface.</span>
          </h1>

          <p className="hero-lead">
            Sonalit connects vehicles, convoys, container delivery and field security into one
            operational surface — so what happens on the road, at the yard and in the control room
            stays connected.
          </p>

          <div className="hero-actions">
            <a href="/login" className="btn btn-primary">
              Access Platform <span aria-hidden="true">↗</span>
            </a>
            <a href="#capabilities" className="btn btn-ghost">
              See the system <span aria-hidden="true">↓</span>
            </a>
          </div>

          <div className="hero-meta" aria-label="Platform principles">
            <div className="meta meta-signal">
              <strong>One record</strong>
              <span>Across every surface</span>
            </div>
            <div className="meta meta-orange">
              <strong>Live work</strong>
              <span>Built around operations</span>
            </div>
            <div className="meta meta-cyan">
              <strong>Traceable</strong>
              <span>From movement to proof</span>
            </div>
          </div>
        </div>

        <div className="hero-command" aria-label="Sonalit operations surface preview">
          <div className="command-label command-label-top">
            <span>LIVE PRODUCT SURFACE</span>
            <span className="mono">SONALIT / OPS</span>
          </div>

          <div className="command-frame">
            <div className="command-image">
              <ContainerVisual priority />
              <div className="command-image-wash" aria-hidden="true" />
              <div className="command-route" aria-hidden="true">
                <span className="route-node route-node-a" />
                <span className="route-line" />
                <span className="route-node route-node-b" />
              </div>
              <span className="command-caption">PORT → CORRIDOR → DELIVERY</span>
            </div>

            <div className="command-stack">
              <div className="command-cell tone-fleet">
                <span className="cell-index">01</span>
                <span className="cell-name">Fleet</span>
                <span className="cell-note">Vehicles / journeys</span>
              </div>
              <div className="command-cell tone-convoy">
                <span className="cell-index">02</span>
                <span className="cell-name">Convoy</span>
                <span className="cell-note">Corridor / field</span>
              </div>
              <div className="command-cell tone-container">
                <span className="cell-index">03</span>
                <span className="cell-name">Container</span>
                <span className="cell-note">Custody / e-lock</span>
              </div>
              <div className="command-cell tone-security">
                <span className="cell-index">04</span>
                <span className="cell-name">Security</span>
                <span className="cell-note">Alert / response</span>
              </div>
            </div>
          </div>

          <div className="command-foot">
            <span>OPERATIONAL VISIBILITY</span>
            <span className="command-status"><i aria-hidden="true" /> CONNECTED SURFACES</span>
          </div>
        </div>
      </header>

      <nav className="system-ribbon" aria-label="Sonalit operating domains">
        {PLATFORM_LINKS.map((link, index) => (
          <a
            key={link.href}
            href={link.href}
            className={`ribbon-item ribbon-${index + 1}`}
          >
            <span className="ribbon-number">0{index + 1}</span>
            <span>
              <strong>{link.label}</strong>
              <small>{link.blurb.split('.')[0]}.</small>
            </span>
            <span className="ribbon-arrow" aria-hidden="true">↗</span>
          </a>
        ))}
      </nav>

      <section className="section capability-section" id="capabilities" aria-labelledby="capabilities-heading">
        <SectionHeading
          id="capabilities-heading"
          label="The operating model"
          title="Four operating domains. One record."
          desc="Sonalit is deliberately split by the work teams do, but not by the data they need to trust."
        />

        <div className="cap-grid">
          {PLATFORM_LINKS.map((link) => (
            <CapCard key={link.href} link={link} />
          ))}
        </div>
      </section>

      <section className="section lifecycle-section" aria-labelledby="lifecycle-heading">
        <div className="lifecycle-intro">
          <SectionHeading
            id="lifecycle-heading"
            label="The Sonalit model"
            title="From planned movement to proven delivery."
            desc="The system follows the operational lifecycle instead of forcing the operation to follow the software."
          />
          <p className="lifecycle-aside">
            <span className="mono">CONTROL / EVIDENCE / CONTINUITY</span>
            <br />
            Every stage leaves context for the next.
          </p>
        </div>

        <div className="lifecycle-grid">
          {LIFECYCLE.map((step) => (
            <article className={`lifecycle-card tone-${step.tone}`} key={step.number}>
              <span className="lifecycle-number">{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <span className="lifecycle-rule" aria-hidden="true" />
            </article>
          ))}
        </div>
      </section>

      <section className="statement-band" aria-label="Sonalit operating principle">
        <p className="statement-overline mono">THE POINT IS NOT MORE SOFTWARE</p>
        <p className="statement">
          The point is fewer versions of the truth.
        </p>
        <p className="statement-note">
          Fleet, field, cargo and security work from the same operational record.
        </p>
      </section>

      <section className="section feature-section section-tight" aria-label="How Sonalit works">
        <FeatureBlock
          title="Fleet visibility that stays ahead of the road"
          body="Continuous awareness of vehicle location, status and operational health, so decisions are made on what is happening rather than on what was reported afterwards."
          points={[
            'Live GPS tracking and journey replay',
            'Vehicle, driver and device registers in one place',
            'Maintenance and fuel recorded against the vehicle',
            'Operational dashboards for fleet leaders',
          ]}
          visual={<FleetVisual />}
          visualLabel="Fleet Network"
        />

        <FeatureBlock
          flip
          title="Convoy &amp; security in one surface"
          body="Coordinate complex multi-vehicle movements while holding a continuous security posture, with the control room and the officers on the road working the same record."
          points={[
            'Convoy planning and real-time monitoring',
            'Corridor evaluation and geofence awareness',
            'Incident, alert and panic escalation',
            'Field officer coordination and reporting',
          ]}
          visual={<ConvoyVisual />}
          visualLabel="Convoy Corridor"
        />

        <FeatureBlock
          title="Container delivery with full traceability"
          body="From booking through e-lock operations, yard and port movements and digital proof of delivery — every step stays visible and auditable."
          points={[
            'Booking and container workflows',
            'E-lock clamp and unclamp operations',
            'Yard and port crew coordination',
            'Proof of delivery and custody record',
          ]}
          visual={<OpsVisual />}
          visualLabel="CDS Workflow"
        />
      </section>

      <CtaBand
        title="Run the operation, not the reconciliation."
        body="Access Sonalit and bring fleet, convoy, container and security into one operational surface."
      />
    </MarketingLayout>
  );
}
