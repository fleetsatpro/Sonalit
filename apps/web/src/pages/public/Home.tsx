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

export default function Home(): React.ReactElement {
  return (
    <MarketingLayout page={PAGE}>
      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <header className="hero">
        <div>
          <div className="hero-badge">
            <i aria-hidden="true" /> Enterprise Operations Platform
          </div>
          <h1>
            Intelligent Fleet,
            <br />
            <span className="grad">Convoy &amp; Logistics</span>
            <br />
            Operations
          </h1>
          <p className="hero-lead">
            Real-time command of vehicles, convoys, containers and field security — engineered for
            high-stakes logistics and continuous operations.
          </p>
          <div className="hero-actions">
            <a href="/login" className="btn btn-primary">
              Access Platform
            </a>
            <a href="#capabilities" className="btn btn-ghost">
              Explore Capabilities
            </a>
          </div>
          <div className="hero-meta">
            <div className="meta">
              <strong>Real-time</strong>
              <span>Visibility</span>
            </div>
            <div className="meta">
              <strong>End-to-end</strong>
              <span>Traceability</span>
            </div>
            <div className="meta">
              <strong>Mission</strong>
              <span>Ready</span>
            </div>
          </div>
        </div>

        {/*
          The command panel is a product illustration, not a telemetry feed.
          It is labelled "Operations view" and its three tiles name what the
          platform tracks — deliberately not invented counts of live convoys or
          vehicles, which would be a fabricated claim on a public page.
        */}
        <div className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <span className="live" aria-hidden="true" /> Operations view
            </div>
            <div className="panel-head-right">SONALIT · OPS</div>
          </div>
          <div className="panel-body">
            <div className="panel-visual">
              <ContainerVisual priority />
            </div>
            <div className="panel-stats">
              <div className="pstat">
                <strong>Convoys</strong>
                <span>Corridor watch</span>
              </div>
              <div className="pstat">
                <strong>Vehicles</strong>
                <span>Live tracking</span>
              </div>
              <div className="pstat">
                <strong>Containers</strong>
                <span>Chain of custody</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── CAPABILITIES ─────────────────────────────────────────────────── */}
      <section className="section" id="capabilities" aria-labelledby="capabilities-heading">
        <SectionHeading
          id="capabilities-heading"
          label="Capabilities"
          title="One command layer for complex operations"
          desc="Sonalit unifies fleet, convoy, container delivery and security into a single operational surface built for scale."
        />
        <div className="cap-grid">
          {PLATFORM_LINKS.map((link) => (
            <CapCard key={link.href} link={link} />
          ))}
        </div>
      </section>

      {/* ── FEATURES ─────────────────────────────────────────────────────── */}
      <section className="section section-tight" aria-label="How Sonalit works">
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
        title="Ready to take command?"
        body="Access the Sonalit operations platform and bring fleet, convoy, container and security under one intelligent surface."
      />
    </MarketingLayout>
  );
}
