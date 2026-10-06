import MarketingLayout from '../../components/marketing/MarketingLayout.js';
import {
  CtaBand,
  FeatureBlock,
  RelatedPages,
  SectionHeading,
} from '../../components/marketing/ui.js';
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
    title: 'Fleet',
    claim: 'Know where the work is.',
    body: 'Live vehicle position, driver assignment, journey history and fleet records in one view.',
    href: '/fleet-management',
    tone: 'fleet',
  },
  {
    code: '02',
    title: 'Convoy',
    claim: 'Keep the corridor under watch.',
    body: 'Plan the route, watch the movement and bring field reports into the same operation.',
    href: '/convoy-management',
    tone: 'convoy',
  },
  {
    code: '03',
    title: 'Container',
    claim: 'Know who has custody.',
    body: 'Booking, container movement, e-lock activity, handover and delivery proof stay connected.',
    href: '/container-delivery',
    tone: 'container',
  },
  {
    code: '04',
    title: 'Security',
    claim: 'Turn exceptions into action.',
    body: 'Alerts, geofences, panic events and field response arrive with the context needed to act.',
    href: '/security-operations',
    tone: 'security',
  },
];

const HANDOFFS = [
  {
    number: '01',
    label: 'DEPART',
    title: 'Put the movement on record.',
    body: 'Assign the vehicle, the driver, the load and the route before the wheels turn.',
  },
  {
    number: '02',
    label: 'MOVE',
    title: 'Watch what changes.',
    body: 'Location, corridor conditions, exceptions and field updates stay attached to the journey.',
  },
  {
    number: '03',
    label: 'TRANSFER',
    title: 'Keep custody visible.',
    body: 'When cargo, control or responsibility changes hands, the event stays in sequence.',
  },
  {
    number: '04',
    label: 'DELIVER',
    title: 'Close the loop with evidence.',
    body: 'Proof of delivery and the operational trail remain available after the movement ends.',
  },
];

function HeroMedia(): React.ReactElement {
  return (
    <div className="home-hero-media">
      <div className="home-hero-satellite">
        <OpsVisual priority />
        <div className="home-hero-satellite-caption">
          <span className="mono">EARTH OBSERVATION</span>
          <strong>Port activity seen from orbit.</strong>
          <p>Reference imagery, not live telemetry.</p>
        </div>
      </div>

      <div className="home-hero-side">
        <div className="home-hero-side-photo">
          <FleetVisual />
          <span className="mono">ROAD FREIGHT</span>
        </div>
        <div className="home-hero-side-photo">
          <ContainerVisual />
          <span className="mono">OCEAN FREIGHT</span>
        </div>
      </div>
    </div>
  );
}

export default function Home(): React.ReactElement {
  return (
    <MarketingLayout page={PAGE}>
      <header className="home-hero">
        <div className="home-hero-copy">
          <p className="home-eyebrow mono">SONALIT / LOGISTICS OPERATIONS PLATFORM</p>

          <h1>
            Know what&apos;s moving.
            <span> Know what changed.</span>
          </h1>

          <p className="home-hero-lead">
            Sonalit connects fleet movement, convoy control, container custody and security response
            in one operational record — from departure to delivery.
          </p>

          <div className="hero-actions">
            <a href="/login" className="btn btn-primary">
              Enter Sonalit <span aria-hidden="true">↗</span>
            </a>
            <a href="#platform" className="btn btn-ghost">
              See the platform <span aria-hidden="true">↓</span>
            </a>
          </div>

          <div className="home-proof-line">
            <span className="mono">BUILT FOR</span>
            <span>CONTROL ROOMS</span>
            <span>FIELD TEAMS</span>
            <span>CARGO OPERATIONS</span>
          </div>
        </div>

        <HeroMedia />
      </header>

      <section className="home-intro-band" aria-labelledby="intro-heading">
        <div className="home-intro-kicker mono">THE OPERATING IDEA</div>
        <div>
          <h2 id="intro-heading">
            One movement.
            <br />
            No broken handoffs.
          </h2>
          <p>
            A vehicle leaves a yard. A convoy enters a corridor. A container changes hands. An
            exception interrupts the plan. Sonalit keeps the same movement, identity and evidence
            together through each transition.
          </p>
        </div>
      </section>

      <section className="section home-platform" id="platform" aria-labelledby="platform-heading">
        <div className="home-section-intro">
          <p className="eyebrow mono">THE PLATFORM</p>
          <h2 id="platform-heading">Four operational surfaces. One source of truth.</h2>
          <p>
            Use one part of Sonalit without losing the rest of the story. The fleet record can feed
            the convoy, the convoy can carry the container record, and a security event can follow
            the same movement instead of starting a new case.
          </p>
        </div>

        <div className="home-domain-list">
          {DOMAINS.map((domain) => (
            <a
              className={`home-domain-row tone-${domain.tone}`}
              href={domain.href}
              key={domain.href}
            >
              <span className="home-domain-number mono">{domain.code}</span>
              <div className="home-domain-main">
                <h3>{domain.title}</h3>
                <strong>{domain.claim}</strong>
              </div>
              <p>{domain.body}</p>
              <span className="home-domain-arrow" aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      </section>

      <section className="home-handoffs" aria-labelledby="handoffs-heading">
        <div className="section home-handoffs-inner">
          <div className="home-section-intro">
            <p className="eyebrow mono">FROM DEPARTURE TO DELIVERY</p>
            <h2 id="handoffs-heading">The operation changes. The record doesn&apos;t.</h2>
            <p>
              The strongest logistics platforms make complexity legible. Sonalit does that by
              following the work itself — not by forcing every role into the same dashboard.
            </p>
          </div>

          <div className="home-handoff-grid">
            {HANDOFFS.map((item) => (
              <article className="home-handoff" key={item.number}>
                <div className="home-handoff-top">
                  <span className="home-handoff-number mono">{item.number}</span>
                  <span className="home-handoff-label mono">{item.label}</span>
                </div>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section home-capabilities" aria-labelledby="capabilities-heading">
        <SectionHeading
          id="capabilities-heading"
          label="What the team gets"
          title="Less status chasing. More operational control."
          desc="The platform is useful because it turns raw movement into something a person can work with: a clear status, an exception, a handoff, a response, a record."
        />

        <FeatureBlock
          title="See the fleet as a working network"
          body="Know where vehicles are, what journey they are on and what sits behind the dot. Live position is paired with the vehicle, driver, device and journey record that gives it meaning."
          points={[
            'Live vehicle position and journey history',
            'Vehicle, driver and device registers',
            'Geofences, alerts and route-aware events',
            'Replay for reconstructing completed journeys',
          ]}
          visual={<FleetVisual />}
          visualLabel="Fleet / road freight"
        />

        <FeatureBlock
          flip
          title="Keep convoy control close to the road"
          body="Planning, corridor awareness and field reporting stay in one operational thread. When the route changes, the people in the control room do not have to rebuild the picture from messages."
          points={[
            'Planned routes and corridor monitoring',
            'Field checks, photos and status updates',
            'Incident and panic escalation with context',
            'Operational reporting built from the journey',
          ]}
          visual={<ConvoyVisual />}
          visualLabel="Convoy / field movement"
        />

        <FeatureBlock
          title="Know the container, not just the milestone"
          body="Track the cargo through booking, movement and handover. E-lock actions and delivery evidence sit against the same container and trip record."
          points={[
            'Booking and container lifecycle',
            'E-lock clamp and unclamp operations',
            'Custody and handover history',
            'Proof of delivery and delivery evidence',
          ]}
          visual={<ContainerVisual />}
          visualLabel="Container / ocean freight"
        />

        <FeatureBlock
          flip
          title="Give security teams something concrete to act on"
          body="Bring location, geofences, device signals and field reports into the same incident context so an alert starts a response instead of becoming another message to chase."
          points={[
            'Prioritised alerts and incident queues',
            'Panic escalation with movement context',
            'Geofence and corridor exceptions',
            'Response history for review and reporting',
          ]}
          visual={<OpsVisual />}
          visualLabel="Security / situational awareness"
        />
      </section>

      <section className="home-close-band" aria-labelledby="close-heading">
        <div className="section home-close-inner">
          <div>
            <p className="eyebrow mono">THE PROMISE</p>
            <h2 id="close-heading">When the operation gets complicated, the picture should get clearer.</h2>
          </div>
          <p>
            Sonalit is designed for the part of logistics that happens between the systems: the
            movement, the handoff, the exception and the proof.
          </p>
        </div>
      </section>

      <CtaBand
        title="See Sonalit in operation."
        body="Bring fleet, convoy, container delivery and security into one working picture — then keep the evidence when the movement is done."
        primaryLabel="Enter Sonalit Platform"
        secondaryLabel="Talk to the team"
      />

      <RelatedPages currentPath="/" />
    </MarketingLayout>
  );
}
