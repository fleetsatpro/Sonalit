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

const DOMAINS = [
  {
    index: '01',
    name: 'Fleet',
    detail: 'Vehicles, drivers, devices and journeys',
    href: '/fleet-management',
    tone: 'signal',
  },
  {
    index: '02',
    name: 'Convoy',
    detail: 'Movement planning, corridors and field control',
    href: '/convoy-management',
    tone: 'copper',
  },
  {
    index: '03',
    name: 'Container',
    detail: 'Booking, custody, e-locks and delivery proof',
    href: '/container-delivery',
    tone: 'teal',
  },
  {
    index: '04',
    name: 'Security',
    detail: 'Situational awareness, alerts and response',
    href: '/security-operations',
    tone: 'danger',
  },
];

const HANDOFFS = [
  ['01', 'Departure', 'The movement starts with a known vehicle, crew, cargo and route.'],
  ['02', 'Execution', 'The same operational record follows the work through the corridor and the field.'],
  ['03', 'Delivery', 'Evidence, custody and incidents stay attached to the movement instead of becoming a separate report.'],
];

export default function Home(): React.ReactElement {
  return (
    <MarketingLayout page={PAGE}>
      <header className="hero">
        <div className="hero-copy">
          <div className="hero-badge">
            <span className="hero-badge-mark" aria-hidden="true" />
            Sonalit / Global logistics operations
          </div>

          <p className="hero-kicker">GLOBAL MOVEMENT / CONTROLLED</p>

          <h1>
            Every movement deserves
            <br />
            <span className="hero-title-accent">one source of truth.</span>
          </h1>

          <p className="hero-lead">
            Sonalit brings fleet tracking, convoy command, container custody and security operations
            into the same working system — from departure to delivery.
          </p>

          <div className="hero-actions">
            <a href="/login" className="btn btn-primary">
              Enter Sonalit <span aria-hidden="true">↗</span>
            </a>
            <a href="#platform" className="btn btn-ghost">
              See the system <span aria-hidden="true">↓</span>
            </a>
          </div>

          <div className="hero-proof" aria-label="Sonalit operating principle">
            <span>01</span>
            <p>
              One operational record
              <strong>across road, yard, port and control room.</strong>
            </p>
          </div>
        </div>

        <div className="hero-visual" aria-label="Sonalit product and operations visual">
          <div className="hero-visual-frame">
            <div className="hero-visual-image">
              <ContainerVisual priority />
            </div>
            <div className="hero-visual-rail" aria-hidden="true">
              <span className="rail rail-signal" />
              <span className="rail rail-copper" />
              <span className="rail rail-teal" />
              <span className="rail rail-danger" />
            </div>
            <div className="hero-visual-caption">
              <span className="mono">SONALIT / SYSTEM VIEW</span>
              <span>Port → Corridor → Delivery</span>
            </div>
          </div>
          <div className="hero-visual-note">
            <span className="mono">THE WORK</span>
            <strong>Moves through one connected chain.</strong>
          </div>
        </div>
      </header>

      <section className="domain-strip" id="platform" aria-labelledby="domain-heading">
        <div className="domain-intro">
          <p className="eyebrow">The platform</p>
          <h2 id="domain-heading">Four disciplines.<br />One operating picture.</h2>
          <p>
            Different teams can own different work without fragmenting the movement itself.
          </p>
        </div>

        <div className="domain-list">
          {DOMAINS.map((domain) => (
            <a
              key={domain.href}
              href={domain.href}
              className={`domain-row domain-${domain.tone}`}
            >
              <span className="domain-index mono">{domain.index}</span>
              <span className="domain-name">{domain.name}</span>
              <span className="domain-detail">{domain.detail}</span>
              <span className="domain-arrow" aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      </section>

      <section className="section capabilities-section" aria-labelledby="capabilities-heading">
        <SectionHeading
          id="capabilities-heading"
          label="What Sonalit connects"
          title="The system is organised around the work, not the org chart."
          desc="A fleet manager can see the movement. A convoy controller can see the corridor. A delivery team can see custody. Security can see the same event from the same record."
        />
        <div className="cap-grid">
          {PLATFORM_LINKS.map((link) => (
            <CapCard key={link.href} link={link} />
          ))}
        </div>
      </section>

      <section className="handoff-band" aria-labelledby="handoff-heading">
        <div className="handoff-heading">
          <p className="eyebrow eyebrow-light">Why the chain matters</p>
          <h2 id="handoff-heading">
            Most operational problems happen in the handoff.
          </h2>
          <p>
            A movement changes hands many times. Sonalit keeps the context with it instead of
            restarting the story at every department.
          </p>
        </div>

        <div className="handoff-list">
          {HANDOFFS.map(([index, title, body]) => (
            <article className="handoff-row" key={index}>
              <span className="handoff-index mono">{index}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section feature-section" aria-label="Sonalit capabilities in context">
        <FeatureBlock
          title="Know where the fleet is — and what the movement means"
          body="Tracking becomes useful when a position sits beside the vehicle, driver, journey and operating context it belongs to."
          points={[
            'Live GPS tracking and journey history',
            'Vehicle, driver and device registers',
            'Journey replay and geofence events',
            'Fleet maintenance and fuel records',
          ]}
          visual={<FleetVisual />}
          visualLabel="Fleet / movement"
        />

        <FeatureBlock
          flip
          title="Coordinate the corridor without losing the field"
          body="Convoy work needs planning, monitoring and security to remain part of the same operational picture, especially when conditions change."
          points={[
            'Convoy planning and real-time monitoring',
            'Corridor and geofence awareness',
            'Incident and panic escalation',
            'Field officer coordination',
          ]}
          visual={<ConvoyVisual />}
          visualLabel="Convoy / corridor"
        />

        <FeatureBlock
          title="Finish with proof, not a second story"
          body="Container delivery connects booking, custody, e-lock activity, yard and port movements and proof of delivery so the record survives the handoff."
          points={[
            'Booking and container workflows',
            'E-lock clamp and unclamp operations',
            'Port and yard coordination',
            'Proof of delivery and custody history',
          ]}
          visual={<OpsVisual />}
          visualLabel="Container / custody"
        />
      </section>

      <section className="closing-statement" aria-label="Sonalit closing statement">
        <p className="eyebrow">Sonalit</p>
        <p className="closing-line">
          Move the cargo.
          <br />
          <span>Keep the context.</span>
        </p>
        <div className="closing-rule" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      </section>

      <CtaBand
        title="Bring the movement into one operating picture."
        body="Enter Sonalit and work across fleet, convoy, container delivery and security without splitting the record."
      />
    </MarketingLayout>
  );
}
