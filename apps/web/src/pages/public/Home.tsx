import MarketingLayout from '../../components/marketing/MarketingLayout.js';
import { PLATFORM_LINKS } from '../../components/marketing/nav.js';
import { CtaBand, FeatureBlock, SectionHeading } from '../../components/marketing/ui.js';
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
    code: '01',
    name: 'Fleet',
    color: '#22e8ff',
    detail: 'Vehicles · drivers · devices · journeys',
    href: '/fleet-management',
  },
  {
    code: '02',
    name: 'Convoy',
    color: '#ffc93f',
    detail: 'Movement · corridors · field control',
    href: '/convoy-management',
  },
  {
    code: '03',
    name: 'Container',
    color: '#f97316',
    detail: 'Booking · custody · e-lock · delivery',
    href: '/container-delivery',
  },
  {
    code: '04',
    name: 'Security',
    color: '#ff3b5c',
    detail: 'Alerts · risk · response · evidence',
    href: '/security-operations',
  },
];

const OPERATIONAL_CHAIN = [
  ['01', 'Locate', 'Know the vehicle, journey and movement context.'],
  ['02', 'Coordinate', 'Keep convoy, corridor and field teams aligned.'],
  ['03', 'Control', 'Carry custody, e-lock and delivery events with the movement.'],
  ['04', 'Prove', 'Leave a traceable operational record when the work is complete.'],
];

function CommandAtlas(): React.ReactElement {
  return (
    <div className="command-atlas">
      <div className="atlas-head">
        <div>
          <span className="atlas-kicker mono">SONALIT / OPERATING PICTURE</span>
          <strong>Movement, connected.</strong>
        </div>
        <span className="atlas-state mono">SYSTEM SURFACE</span>
      </div>

      <div className="atlas-canvas">
        <svg className="atlas-route" viewBox="0 0 680 500" role="img" aria-label="Abstract Sonalit operating picture connecting fleet, convoy, container and security workflows">
          <g className="atlas-grid" aria-hidden="true">
            <path d="M0 80H680M0 160H680M0 240H680M0 320H680M0 400H680" />
            <path d="M80 0V500M180 0V500M280 0V500M380 0V500M480 0V500M580 0V500" />
          </g>

          <g className="atlas-corridors" aria-hidden="true">
            <path d="M52 384 C152 335 196 352 258 278 S372 150 452 202 544 276 628 124" />
            <path d="M76 418 C186 372 212 398 294 330 S388 212 462 250 538 326 616 208" />
            <path d="M142 102 C226 144 282 112 338 170 S430 300 518 270" />
          </g>

          <g className="atlas-nodes" aria-hidden="true">
            <circle cx="52" cy="384" r="6" className="node node-fleet" />
            <circle cx="258" cy="278" r="7" className="node node-convoy" />
            <circle cx="452" cy="202" r="8" className="node node-container" />
            <circle cx="628" cy="124" r="7" className="node node-security" />
            <circle cx="338" cy="170" r="5" className="node node-fleet" />
            <circle cx="518" cy="270" r="5" className="node node-security" />
          </g>

          <g className="atlas-labels">
            <g transform="translate(20 338)">
              <rect width="116" height="42" />
              <text x="12" y="16">FLEET</text>
              <text x="12" y="31">movement source</text>
            </g>
            <g transform="translate(226 224)">
              <rect width="126" height="42" />
              <text x="12" y="16">CONVOY</text>
              <text x="12" y="31">corridor control</text>
            </g>
            <g transform="translate(415 144)">
              <rect width="138" height="42" />
              <text x="12" y="16">CONTAINER</text>
              <text x="12" y="31">custody record</text>
            </g>
            <g transform="translate(548 70)">
              <rect width="112" height="42" />
              <text x="12" y="16">SECURITY</text>
              <text x="12" y="31">response layer</text>
            </g>
          </g>
        </svg>
      </div>

      <div className="atlas-foot">
        <span className="mono">01—04</span>
        <span>Four operating disciplines. One connected chain.</span>
        <span className="atlas-foot-rule" aria-hidden="true" />
      </div>
    </div>
  );
}

export default function Home(): React.ReactElement {
  return (
    <MarketingLayout page={PAGE}>
      <header className="hero hero-home">
        <div className="hero-home-copy">
          <div className="hero-badge">
            <span className="hero-badge-mark" aria-hidden="true" />
            Sonalit / Global logistics operations
          </div>

          <p className="hero-kicker mono">CONTROL THE MOVEMENT / KEEP THE RECORD</p>

          <h1>
            The control layer for movement
            <span> that cannot lose context.</span>
          </h1>

          <p className="hero-lead">
            Fleet tracking, convoy command, container delivery and security operations — connected
            through the same operational picture from departure to delivery.
          </p>

          <div className="hero-actions">
            <a href="/login" className="btn btn-primary">
              Enter Sonalit <span aria-hidden="true">↗</span>
            </a>
            <a href="#platform" className="btn btn-ghost">
              Explore the platform <span aria-hidden="true">↓</span>
            </a>
          </div>

          <div className="hero-identity">
            <span className="hero-identity-key mono">DESIGNED FOR</span>
            <span>CONTROL ROOMS</span>
            <span>FIELD TEAMS</span>
            <span>LOGISTICS OPERATORS</span>
          </div>
        </div>

        <CommandAtlas />
      </header>

      <section className="domain-index" id="platform" aria-labelledby="domain-index-heading">
        <div className="domain-index-intro">
          <p className="eyebrow mono">THE PLATFORM</p>
          <h2 id="domain-index-heading">
            One movement.
            <br />
            Four operating disciplines.
          </h2>
          <p>
            Sonalit does not ask operations teams to move the truth from system to system. The
            movement carries its own context.
          </p>
        </div>

        <div className="domain-index-list">
          {DOMAINS.map((domain) => (
            <a
              className="domain-index-row"
              href={domain.href}
              key={domain.href}
              style={{ '--domain-color': domain.color } as React.CSSProperties}
            >
              <span className="domain-index-code mono">{domain.code}</span>
              <span className="domain-index-name">{domain.name}</span>
              <span className="domain-index-detail">{domain.detail}</span>
              <span className="domain-index-arrow" aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      </section>

      <section className="statement-band" aria-labelledby="statement-heading">
        <div className="statement-grid">
          <p className="eyebrow mono">THE PRINCIPLE</p>
          <div>
            <h2 id="statement-heading">
              When the work changes hands,
              <span> the context should not.</span>
            </h2>
            <p>
              A vehicle leaves a yard. A convoy enters a corridor. A container changes custody. A
              security event interrupts the plan. Sonalit keeps those moments inside the same
              operational story.
            </p>
          </div>
        </div>
      </section>

      <section className="section operation-section" aria-labelledby="operation-heading">
        <SectionHeading
          id="operation-heading"
          label="How the system holds together"
          title="The operation is a chain, not a collection of screens."
          desc="Each stage adds context to the same movement. Teams see the part they own without losing the whole."
        />

        <div className="operation-chain">
          {OPERATIONAL_CHAIN.map(([index, title, body], i) => (
            <article className="operation-step" key={index}>
              <div className="operation-step-head">
                <span className="operation-step-index mono">{index}</span>
                <span className="operation-step-line" aria-hidden="true" />
              </div>
              <h3>{title}</h3>
              <p>{body}</p>
              {i < OPERATIONAL_CHAIN.length - 1 ? (
                <span className="operation-step-arrow" aria-hidden="true">→</span>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="section feature-section" aria-label="Sonalit capabilities">
        <FeatureBlock
          title="See the fleet as movement, not just dots on a map"
          body="Tracking becomes operational when a position is attached to the vehicle, driver, device and journey context that explains it."
          points={[
            'Live GPS tracking and journey history',
            'Vehicle, driver and device registers',
            'Journey replay and geofence events',
            'Maintenance and fuel records',
          ]}
          visual={<FleetVisual />}
          visualLabel="Fleet / movement"
        />

        <FeatureBlock
          flip
          title="Run the corridor with the field still in view"
          body="Convoy planning, corridor awareness, escalation and field coordination belong in the same operating picture when conditions change."
          points={[
            'Convoy planning and monitoring',
            'Corridor and geofence awareness',
            'Incident and panic escalation',
            'Field officer coordination',
          ]}
          visual={<ConvoyVisual />}
          visualLabel="Convoy / corridor"
        />

        <FeatureBlock
          title="End with evidence that survives the handoff"
          body="Booking, custody, e-lock activity, yard and port movements and proof of delivery remain part of the operational record."
          points={[
            'Booking and container workflows',
            'E-lock clamp and unclamp operations',
            'Port and yard coordination',
            'Proof of delivery and custody history',
          ]}
          visual={<ContainerVisual />}
          visualLabel="Container / custody"
        />
      </section>

      <section className="proof-strip" aria-labelledby="proof-heading">
        <div>
          <p className="eyebrow mono">THE DIFFERENCE</p>
          <h2 id="proof-heading">Operational truth is more valuable than operational noise.</h2>
        </div>
        <p>
          Sonalit is built around the real work of moving vehicles and cargo: visibility, control,
          escalation, custody and proof.
        </p>
      </section>

      <CtaBand
        title="Make the movement visible from every seat in the operation."
        body="Enter Sonalit to bring fleet, convoy, container delivery and security into one operational picture."
      />
    </MarketingLayout>
  );
}
