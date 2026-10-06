import MarketingLayout from '../../components/marketing/MarketingLayout.js';
import {
  CtaBand,
  FeatureBlock,
  RelatedPages,
  SectionHeading,
} from '../../components/marketing/ui.js';
import { ConvoyVisual, OpsVisual } from '../../components/marketing/visuals.js';
import { getPageSeo } from '../../lib/seo/pages.js';

const PAGE = getPageSeo('/security-operations');

export default function SecurityOperations(): React.ReactElement {
  return (
    <MarketingLayout page={PAGE}>
      <header className="hero hero-compact">
        <div className="hero-badge">
          <i aria-hidden="true" /> Security Operations
        </div>
        <h1>
          Turn signals into an operational picture.
        </h1>
        <p className="hero-lead">
          Sonalit connects alerts, location, device health, geofences, route risk, field reports and spatial context into a response fabric — giving operators the evidence and chronology needed to distinguish noise from an incident and an incident from a decision.
        </p>
      </header>

      <section className="section section-tight" aria-label="Security operations capabilities">
        <FeatureBlock
          title="From detection to response, without losing the trail"
          body="An alert becomes useful when its context survives the handoff. Sonalit links detection, acknowledgement, response activity and resolution into one chronology, so the same record can support live intervention and later reconstruction."
          points={[
            'Prioritised alerts and incident queues',
            'Panic escalation with movement and location context',
            'Response crews and field reports on the same incident',
            'Incident history retained for reconstruction and review',
          ]}
          visual={<OpsVisual />}
          visualLabel="Alert &amp; Response"
        />

        <FeatureBlock
          flip
          title="Geography, signal integrity and world context as controls"
          body="Geofences and corridors turn geography into policy. Sonalit can evaluate entry, exit and route departure continuously, while signal health distinguishes a silent device from a normal absence and external context can be brought alongside the operational record."
          points={[
            'Organisation-scoped geofence definition and management',
            'Time-aware corridor evaluation against the planned route',
            'Route-risk analysis for planning and dispatch',
            'Open-source and spatial risk context with provenance',
          ]}
          visual={<ConvoyVisual />}
          visualLabel="Geofence &amp; Corridor"
        />
      </section>

      <section className="section" aria-labelledby="awareness-heading">
        <SectionHeading
          id="awareness-heading"
          label="Situational awareness"
          title="Different surfaces. One operational state."
          desc="Control-room operators, convoy officers, yard crews, response teams and clients do not need identical interfaces. They need consistent state. Sonalit gives each role the surface appropriate to its decisions while preserving the shared chronology underneath."
        />
        <div className="cap-grid cap-grid-3">
          <article className="cap">
            <div className="cap-icon" aria-hidden="true">≋</div>
            <h3>Realtime operational feed</h3>
            <p>Alerts, incidents and field activity can arrive as a realtime stream, preserving chronology across the operational workspace.</p>
          </article>
          <article className="cap">
            <div className="cap-icon" aria-hidden="true">⚑</div>
            <h3>Rules and event logic</h3>
            <p>Operational conditions can be expressed as rules so matching events can raise alerts without requiring someone to stare at a map all shift.</p>
          </article>
          <article className="cap">
            <div className="cap-icon" aria-hidden="true">◍</div>
            <h3>Signal integrity</h3>
            <p>Signal analysis distinguishes comms blackout from GPS freeze, making loss of contact itself an operational observation rather than an empty space on the map.</p>
          </article>
        </div>
        <p className="prose prose-after">
          Security operations sit on the same data as{' '}
          <a className="inline-link" href="/fleet-management">fleet management</a>,{' '}
          <a className="inline-link" href="/convoy-management">convoy management</a> and{' '}
          <a className="inline-link" href="/container-delivery">container delivery</a>.
        </p>
      </section>

      <CtaBand
        title="Give the control room context, not just notifications"
        body="From live telemetry and Guardian safety events to route risk, spatial context, communications and incident reconstruction, Sonalit gives security teams a working chain from signal to action to evidence."
      />
      <RelatedPages currentPath="/security-operations" />
    </MarketingLayout>
  );
}
