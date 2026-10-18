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
    <div className="home-v7-stage">
      <OpsVisual priority note="ARCHIVAL SENTINEL-2 / NOT LIVE DATA" />
      <svg
        className="home-v7-route-layer"
        viewBox="0 0 1000 760"
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label="Illustrative route geometry connecting operational context and evidence; it does not depict a live journey."
      >
        <defs>
          <pattern id="sonalit-v7-grid" width="42" height="42" patternUnits="userSpaceOnUse">
            <path d="M42 0H0V42" fill="none" stroke="rgba(223,247,255,.16)" strokeWidth=".7" />
          </pattern>
        </defs>
        <rect width="1000" height="760" fill="url(#sonalit-v7-grid)" />
        <g className="home-v7-contours" fill="none" stroke="rgba(223,247,255,.25)" strokeWidth="1">
          <path d="M-80 170C65 82 162 112 250 175S399 265 521 194 727 70 1080 146" />
          <path d="M-90 204C57 116 161 149 245 210S401 299 527 231 737 108 1089 181" />
          <path d="M-96 240C48 152 156 184 239 245S399 332 530 269 745 145 1095 218" />
          <path d="M-100 277C42 191 149 220 233 281S397 369 535 305 749 182 1102 254" />
          <path d="M-115 512C42 442 184 468 279 531S482 614 607 545 811 427 1080 492" />
          <path d="M-116 548C41 478 184 505 281 567S483 650 610 581 812 464 1082 528" />
          <path d="M-124 585C37 514 180 541 282 603S485 687 614 619 819 501 1090 565" />
        </g>
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path
            className="home-v7-route-secondary"
            d="M90 610C190 540 210 425 337 425S477 514 578 389 713 220 892 245"
          />
          <path
            className="home-v7-route-primary"
            d="M45 333C167 333 183 258 292 281S414 406 528 352 665 288 710 374 823 477 963 393"
          />
          <path
            className="home-v7-route-dash"
            d="M45 333C167 333 183 258 292 281S414 406 528 352 665 288 710 374 823 477 963 393"
          />
        </g>
        <g className="home-v7-route-node" transform="translate(45 333)">
          <circle r="18" fill="none" stroke="#dff7ff" strokeOpacity=".7" />
          <circle r="5" fill="#dff7ff" />
          <path d="M-28 0H-9M9 0H28M0-28V-9M0 9V28" stroke="#dff7ff" strokeWidth="1" />
        </g>
        <g className="home-v7-route-node home-v7-route-node-end" transform="translate(963 393)">
          <circle r="26" fill="none" stroke="#ff754a" strokeOpacity=".8" />
          <circle r="10" fill="none" stroke="#ff754a" strokeWidth="1.5" />
          <circle r="3.5" fill="#ff754a" />
          <path d="M-38 0H-15M15 0H38M0-38V-15M0 15V38" stroke="#ff754a" strokeWidth="1" />
        </g>
        <g className="home-v7-diagram-labels" fill="#f5f9ff">
          <text x="72" y="294">ORIGIN / CONTEXT</text>
          <text x="756" y="447">OUTCOME / PROOF</text>
          <text x="522" y="321">ROUTE GEOMETRY</text>
        </g>
        <g className="home-v7-crosshair" stroke="rgba(223,247,255,.6)" fill="none">
          <path d="M782 116h46m-23-23v46" />
          <circle cx="805" cy="116" r="12" />
          <path d="M159 676h40m-20-20v40" />
          <circle cx="179" cy="696" r="10" />
        </g>
      </svg>
      <div className="home-v7-stage-index mono">
        <span>FIG. 01</span>
        <span>SPACE / TIME / MOTION</span>
      </div>
      <div className="home-v7-stage-note">
        <span className="home-v7-stage-note-mark" aria-hidden="true" />
        <div>
          <strong>One movement.</strong>
          <p>Its route, risks, custody and proof—read together.</p>
        </div>
      </div>
      <div className="home-v7-stage-foot mono">
        <span>ILLUSTRATIVE ROUTE STUDY</span>
        <span>NO LIVE JOURNEY PLOTTED</span>
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
      <div className="home-v6 home-v7">
      <header className="home-hero home-hero-v5 home-v7-hero" data-reveal="hero">
        <div className="home-hero-copy">
          <p className="home-eyebrow mono">SONALIT / OPERATIONAL INTELLIGENCE</p>
          <h1 className="home-v7-title" aria-label="The move. The why. The proof.">
            <span className="home-v7-title-line"><span>THE MOVE.</span></span>
            <span className="home-v7-title-line"><span>THE WHY.</span></span>
            <span className="home-v7-title-line home-v7-title-accent"><span>THE PROOF.</span></span>
          </h1>
          <p className="home-hero-lead">
            Fleet. Convoy. Container custody. Field response.
            One operational picture—with evidence behind every decision.
          </p>

          <div className="hero-actions">
            <a href="/login" className="btn btn-primary">
              Enter workspace <span aria-hidden="true">↗</span>
            </a>
            <a href="#capability-atlas" className="btn btn-ghost">
              Explore the platform <span aria-hidden="true">↓</span>
            </a>
          </div>

          <div className="home-v7-proof-line mono">
            <span>FLEET</span><i aria-hidden="true">/</i>
            <span>CONVOY</span><i aria-hidden="true">/</i>
            <span>CUSTODY</span><i aria-hidden="true">/</i>
            <span>SECURITY</span>
          </div>
        </div>

        <HeroVisual />
      </header>

      <section className="home-v7-sequence" aria-label="Sonalit operational sequence">
        <div className="home-v7-sequence-intro">
          <span className="mono">THE OPERATING LOOP</span>
          <strong>No blind hand-offs.</strong>
        </div>
        <div className="home-v7-sequence-track">
          {[
            ['01', 'Observe', 'Signal and custody.'],
            ['02', 'Interpret', 'Context and risk.'],
            ['03', 'Coordinate', 'People and action.'],
            ['04', 'Prove', 'Chronology and evidence.'],
          ].map(([index, title, body]) => (
            <div className="home-v7-sequence-step" key={index}>
              <span className="home-v7-sequence-index mono">{index}</span>
              <div>
                <h2>{title}</h2>
                <p>{body}</p>
              </div>
              <span className="home-v7-sequence-chevron" aria-hidden="true">↗</span>
            </div>
          ))}
        </div>
      </section>

      <section className="home-v5-thesis" data-reveal="rise" aria-labelledby="thesis-heading">
        <div className="home-v5-thesis-index mono">THE THESIS / 01</div>
        <div>
          <h2 id="thesis-heading">Operations move. Context must move with them.</h2>
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
          <h2 id="planes-heading">Seven planes. One picture.</h2>
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
            <h2 id="stack-heading">A route is one dimension.</h2>
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
          title="Context, without fiction."
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
          title="Built for the moments that matter."
          desc="Sonalit closes the gaps between moving assets, field teams, security workflows, client visibility and the proof that remains when a movement is over."
        />

        <FeatureBlock
          title="Every vehicle has a history."
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
          title="A corridor is more than a line."
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
          title="Custody from instruction to proof."
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
          title="Response that keeps the evidence."
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
          <h2 id="close-heading">The move ends. The evidence stays.</h2>
          <p>
            Sonalit is designed to preserve the chain between what happened, what the system knows,
            what the team should examine next and what can be proved afterwards.
          </p>
        </div>
      </section>

      <CtaBand
        title="One move. A complete record."
        body="Fleet. Convoy. Container custody. Spatial intelligence. Security response. Field applications. Client visibility. One operational fabric."
        primaryLabel="Enter Sonalit Platform"
        secondaryLabel="Talk to the operations team"
      />

      <RelatedPages currentPath="/" />
      </div>
    </MarketingLayout>
  );
}
