import * as React from 'react';
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
  DecisionLoopVisual,
  FleetVisual,
  OpsVisual,
  WorldFabricVisual,
} from '../../components/marketing/visuals.js';
import { getPageSeo } from '../../lib/seo/pages.js';

const PAGE = getPageSeo('/');

const OPERATING_PLANES = [
  {
    code: '01',
    title: 'Fleet operations',
    claim: 'Movement, asset state and accountability.',
    body: 'Live GPS, driver and device assignment, journey history, replay, geofences, shifts, maintenance, fuel, claims and operational reporting.',
    href: '/fleet-management',
    tone: 'fleet',
  },
  {
    code: '02',
    title: 'Convoy control',
    claim: 'Route discipline with security context.',
    body: 'Route planning, corridor evaluation, risk-ranked routing, waypoints, CFO coordination, seal integrity, photo evidence and daily reports.',
    href: '/convoy-management',
    tone: 'convoy',
  },
  {
    code: '03',
    title: 'Container delivery',
    claim: 'Custody from booking to closure.',
    body: 'Bookings, containers, transporters, trips, electronic locks, yard and port operations, alerts, documents, analytics, billing and delivery proof.',
    href: '/container-delivery',
    tone: 'container',
  },
  {
    code: '04',
    title: 'Security operations',
    claim: 'Signals converted into decisions.',
    body: 'Alerts, incidents, panic escalation, response crews, geofences, rules, signal-integrity checks, communications and after-action reconstruction.',
    href: '/security-operations',
    tone: 'security',
  },
  {
    code: '05',
    title: 'Spatial intelligence',
    claim: 'Context beyond the route line.',
    body: 'XD Live Surveillance, World Context, route geography, hazard fusion, optical reconnaissance and explicit separation of observed, modelled and forecast state.',
    href: '/login',
    tone: 'spatial',
  },
  {
    code: '06',
    title: 'Guardian field layer',
    claim: 'A safety instrument carried into the operation.',
    body: 'Android field agent, GPS, device health, panic escalation, Dead Man’s Switch, signed commands, authorized capture and signal anomaly detection.',
    href: '/login',
    tone: 'guardian',
  },
  {
    code: '07',
    title: 'Client & executive surfaces',
    claim: 'The right picture for the right audience.',
    body: 'Cargo-owner portal, live tracking, custody, POD, documents, notifications, executive views, analytics, reports, finance and governed collaboration.',
    href: '/login',
    tone: 'executive',
  },
] as const;

const APPLICATIONS = [
  ['CONTROL ROOM', 'One operating surface for live movement, alerts, incidents, communications and decision support.'],
  ['FLEET WORKSPACE', 'Vehicles, drivers, devices, shifts, maintenance, fuel, claims and the journeys tying them together.'],
  ['CONVOY WORKSPACE', 'Planning, corridor watch, CFO field activity, seals, evidence, reports and route-risk context.'],
  ['CDS COMMAND', 'A dedicated Container Delivery System for bookings, trips, containers, e-locks, port and yard flow, pulse, billing and reporting.'],
  ['YARD + PORT FIELD APPS', 'Role-specific mobile workflows for clamp, unclamp, departures and custody events where the work physically happens.'],
  ['GUARDIAN ANDROID', 'Device-backed field safety with live location, DMS, panic escalation, integrity controls, commands and signal anomaly detection.'],
  ['INTELLIGENCE CENTRE', 'Collection, source provenance, public-signal alerts, synthesis and controlled publication across security, logistics and geospatial context.'],
  ['CARGO OWNER PORTAL', 'Scoped client visibility into a convoy: track, manifest, custody, exceptions, documents, sensors, security and proof of delivery.'],
] as const;

const DIMENSIONS = [
  ['SPACE', 'Route geometry, corridor membership, risk zones and operational geography.'],
  ['TIME', 'Observation time, chronology, replay, schedules and forecast windows.'],
  ['IDENTITY', 'Vehicles, devices, drivers, convoys, shipments, containers and their relationships.'],
  ['MOTION', 'Position, heading, speed, progress, deviation and ETA.'],
  ['INTEGRITY', 'Freshness, provenance, confidence, uncertainty and source conflict.'],
  ['SECURITY', 'Incidents, exposure, checkpoints, restricted areas and e-lock state.'],
  ['EVIDENCE', 'Telemetry, scans, photos, signatures, lock events and audit records.'],
  ['FUTURE', 'Expected position, scenario lanes and forecast state—never rendered as observed fact.'],
] as const;

const INTELLIGENCE_LAYERS = [
  {
    index: '01',
    title: 'World Context',
    body: 'Fuse the operational record with bounded external observations: public camera registries, viewshed geometry, earthquake detections, active-fire hotspots and orbital catalog context.',
    note: 'External context enriches Sonalit. It does not overwrite Sonalit telemetry or incidents.',
  },
  {
    index: '02',
    title: 'Optical Reconnaissance',
    body: 'Inspect available satellite and optical context alongside the operational map to understand the geography around a movement, rather than treating an image as telemetry.',
    note: 'Imagery availability and acquisition are separate from the operational record.',
  },
  {
    index: '03',
    title: 'Route & Risk',
    body: 'Evaluate movements against route geometry, corridor rules and risk intelligence before dispatch and while the journey is underway.',
    note: 'A risk observation is not automatically a road closure or impact assertion.',
  },
  {
    index: '04',
    title: 'Decision support',
    body: 'AI decision surfaces and Sonalit Copilot help interrogate the record, correlate events and produce explanations while human operators retain approval over consequential actions.',
    note: 'Interpretation is advisory; operational truth remains evidence-backed.',
  },
] as const;

function HeroVisual(): React.ReactElement {
  return (
    <div className="home-command-visual">
      <WorldFabricVisual />
      <div className="home-command-meta">
        <div>
          <span className="mono">SONALIT WORLD MODEL</span>
          <strong>STATE → CONTEXT → DECISION → ACTION → EVIDENCE</strong>
        </div>
        <span className="mono">ILLUSTRATIVE / NOT LIVE TELEMETRY</span>
      </div>
    </div>
  );
}

export default function Home(): React.ReactElement {
  React.useEffect(() => {
    const root = document.querySelector<HTMLElement>('.sonalit-public');
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    root.classList.add('motion-enabled');

    const revealItems = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const item = entry.target as HTMLElement;
          item.classList.add('is-visible');
          observer.unobserve(item);
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.08 },
    );

    revealItems.forEach((item, index) => {
      item.style.setProperty('--reveal-delay', `${Math.min(index, 8) * 70}ms`);
      observer.observe(item);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <MarketingLayout page={PAGE}>
      <header className="home-hero home-hero-v5" data-reveal="hero">
        <div className="home-hero-copy">
          <p className="home-eyebrow mono">OPERATIONAL INTELLIGENCE / MOVEMENT · RISK · CUSTODY · RESPONSE</p>
          <h1>
            Make movement
            <span> intelligible.</span>
          </h1>
          <p className="home-hero-lead">
            Sonalit binds telemetry, route geometry, device state, cargo custody, field activity,
            external-world context and evidence into one operational picture — then carries that
            context from planning to response to proof.
          </p>

          <div className="hero-actions">
            <a href="/login" className="btn btn-primary">
              Enter the operational workspace <span aria-hidden="true">↗</span>
            </a>
            <a href="#capability-atlas" className="btn btn-ghost">
              Read the platform map <span aria-hidden="true">↓</span>
            </a>
          </div>

          <div className="home-proof-line home-proof-line-kinetic home-v5-proof">
            <span className="mono">7 OPERATIONAL PLANES</span>
            <span>8D WORLD MODEL</span>
            <span>ONE AUDITABLE STATE</span>
          </div>
        </div>

        <HeroVisual />
      </header>

      <section className="home-v5-thesis" data-reveal="rise" aria-labelledby="thesis-heading">
        <div className="home-v5-thesis-index mono">THE THESIS / 01</div>
        <div>
          <h2 id="thesis-heading">A logistics operation is not a dashboard. It is a state that keeps changing.</h2>
          <p>
            A truck can be <em>on route</em> and still be exposed. A container can be <em>delivered</em>
            and still lack proof. A device can be <em>online</em> while its GPS is frozen. A hazard can be
            <em> detected</em> without proving operational impact. Sonalit keeps those distinctions visible,
            so the system does not flatten a complex movement into a single status pill.
          </p>
        </div>
      </section>

      <section className="section home-v5-planes" id="capability-atlas" data-reveal="rise" aria-labelledby="planes-heading">
        <div className="home-section-intro">
          <p className="eyebrow mono">THE OPERATING FABRIC</p>
          <h2 id="planes-heading">Seven planes. One operational grammar.</h2>
          <p>
            Sonalit is broader than fleet tracking. Its surfaces are composed around the actual
            transitions of an operation: moving the asset, controlling the corridor, securing the
            cargo, interpreting the world, protecting the field team and proving what happened.
          </p>
        </div>

        <div className="home-v5-plane-list">
          {OPERATING_PLANES.map((plane) => (
            <a
              key={plane.code}
              href={plane.href}
              className={`home-v5-plane tone-${plane.tone}`}
            >
              <span className="home-v5-plane-code mono">{plane.code}</span>
              <div className="home-v5-plane-copy">
                <h3>{plane.title}</h3>
                <strong>{plane.claim}</strong>
                <p>{plane.body}</p>
              </div>
              <span className="home-v5-plane-arrow" aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      </section>

      <section className="home-v5-application-band" data-reveal="rise" aria-labelledby="applications-heading">
        <div className="section">
          <div className="home-v5-section-head">
            <div>
              <p className="eyebrow mono">APPLICATIONS / BUILT FOR THE ACTUAL WORK</p>
              <h2 id="applications-heading">Different jobs. Shared state.</h2>
            </div>
            <p>
              The interface changes with the operator. The underlying movement, identity, event
              chronology and evidence do not.
            </p>
          </div>

          <div className="home-v5-app-grid">
            {APPLICATIONS.map(([title, body], index) => (
              <article key={title} className="home-v5-app" data-reveal="rise">
                <span className="home-v5-app-index mono">{String(index + 1).padStart(2, '0')}</span>
                <h3>{title}</h3>
                <p>{body}</p>
                <div className="home-v5-app-rule" aria-hidden="true" />
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section home-v5-stack" data-reveal="rise" aria-labelledby="stack-heading">
        <div className="home-v5-stack-grid">
          <div>
            <p className="eyebrow mono">8D WORLD MODEL</p>
            <h2 id="stack-heading">The route is only one dimension of the story.</h2>
            <p className="section-desc">
              XD Live Surveillance extends the operational picture across space, time, identity,
              motion, integrity, security, evidence and future state. The point is not theatrical
              3D; it is semantic depth.
            </p>

            <div className="home-v5-dimension-list">
              {DIMENSIONS.map(([label, body], index) => (
                <div className="home-v5-dimension" key={label}>
                  <span className="mono">{String(index + 1).padStart(2, '0')}</span>
                  <strong>{label}</strong>
                  <p>{body}</p>
                </div>
              ))}
            </div>
          </div>

          <WorldFabricVisual compact />
        </div>
      </section>

      <section className="section home-v5-intelligence" data-reveal="rise" aria-labelledby="intelligence-heading">
        <SectionHeading
          id="intelligence-heading"
          label="SPATIAL + DECISION INTELLIGENCE"
          title="See farther without pretending to know more."
          desc="Sonalit can enrich the operational state with external context and analytical interpretation while maintaining hard boundaries between evidence, geometry, inference and forecast."
        />

        <div className="home-v5-intelligence-grid">
          {INTELLIGENCE_LAYERS.map((item) => (
            <article className="home-v5-intelligence-card" key={item.index}>
              <span className="mono">{item.index}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <small>{item.note}</small>
            </article>
          ))}
        </div>

        <div className="home-v5-loop">
          <DecisionLoopVisual />
        </div>
      </section>

      <section className="section home-v5-evidence" data-reveal="rise" aria-labelledby="evidence-heading">
        <div className="home-v5-evidence-copy">
          <p className="eyebrow mono">EVIDENCE CHANGES THE QUALITY OF A DECISION</p>
          <h2 id="evidence-heading">Observed. Modelled. Inferred. Predicted.</h2>
          <p>
            A useful operations platform does not turn every signal into a fact. Sonalit keeps source
            provenance, freshness, confidence and uncertainty attached to the world it presents.
            That makes satellite positions explicitly modelled; camera geometry distinct from image
            acquisition; public hazard detections distinct from confirmed impact; and AI interpretation
            subordinate to the evidence underneath it.
          </p>
        </div>
        <div className="home-v5-evidence-rail" aria-label="State semantics">
          {[
            ['OBSERVED', 'Evidence received or reconciled from an operational source.', 'cyan'],
            ['MODELLED', 'Derived geometry or orbital state with explicit uncertainty.', 'violet'],
            ['INFERRED', 'Analytical interpretation built from canonical state.', 'amber'],
            ['PREDICTED', 'Expected future state; never rendered as observed fact.', 'red'],
          ].map(([label, body, tone]) => (
            <div className={`home-v5-evidence-item tone-${tone}`} key={label}>
              <span className="home-v5-evidence-dot" aria-hidden="true" />
              <div>
                <strong className="mono">{label}</strong>
                <p>{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section home-capabilities" data-reveal="rise" aria-labelledby="core-capabilities-heading">
        <SectionHeading
          id="core-capabilities-heading"
          label="THE OPERATIONAL CORE"
          title="The details are not side features. They are the operation."
          desc="Sonalit closes the gaps between moving assets, field teams, security workflows, client visibility and the proof that remains when a movement is over."
        />

        <FeatureBlock
          title="A live fleet picture that remembers"
          body="Track current position without discarding everything around it. Vehicle, driver, device, journey history, geofence events, replay, shifts, maintenance, fuel and claims sit within the same operational universe."
          points={[
            'Live GPS and tactical mapping with journey history',
            'Drive and operations replay for reconstruction',
            'Vehicle, driver, device and field-officer registers',
            'Maintenance, fuel, shifts, claims and fleet reporting',
          ]}
          visual={<FleetVisual />}
          visualLabel="Fleet / movement record"
        />

        <FeatureBlock
          flip
          title="Convoys governed by route, time and evidence"
          body="Convoy operations carry their own grammar: corridor adherence, route risk, waypoints, CFO assignments, seal integrity, field evidence and generated reports."
          points={[
            'Risk-ranked route and corridor planning',
            'Time-aware corridor evaluation and route deviation',
            'CFO day plans, checkpoints, photos and seal checks',
            'Daily convoy reports with evidence and content integrity',
          ]}
          visual={<ConvoyVisual />}
          visualLabel="Convoy / corridor control"
        />

        <FeatureBlock
          title="Container custody without the blind spots"
          body="CDS turns the container into a first-class operational object, linking bookings, trips, vehicles, drivers, e-locks, yard and port activity, documents, alerts and delivery proof."
          points={[
            'Booking, container, transporter and trip lifecycle',
            'Electronic lock clamp, unlock, tamper and device state',
            'Yard and port field applications with device pairing',
            'Client Pulse, analytics, billing, reports and POD',
          ]}
          visual={<ContainerVisual />}
          visualLabel="CDS / custody chain"
        />

        <FeatureBlock
          flip
          title="Security is a workflow, not an alert colour"
          body="Alerts lead into incidents, incidents into response, and responses into an auditable history. Guardian extends that loop into the field with panic escalation, DMS and device integrity."
          points={[
            'Prioritised alerts, incidents and response queues',
            'Panic escalation and Dead Man’s Switch safety',
            'Signal-integrity analysis for comms blackout and GPS freeze',
            'Signed device commands and governed remote sessions',
          ]}
          visual={<OpsVisual />}
          visualLabel="Security / response fabric"
        />
      </section>

      <section className="home-v5-close" data-reveal="rise" aria-labelledby="close-heading">
        <div className="section">
          <div className="home-v5-close-index mono">THE PROMISE / 07</div>
          <h2 id="close-heading">When every movement creates more data, the answer is not another screen. It is a better model of the operation.</h2>
          <p>
            Sonalit is designed to preserve the chain between what happened, what the system knows,
            what the team should examine next and what can be proved afterwards.
          </p>
        </div>
      </section>

      <CtaBand
        title="Bring the operation into focus."
        body="Fleet. Convoy. Container custody. Spatial intelligence. Security response. Field applications. Client visibility. One operational fabric."
        primaryLabel="Enter Sonalit Platform"
        secondaryLabel="Talk to the operations team"
      />

      <RelatedPages currentPath="/" />
    </MarketingLayout>
  );
}
