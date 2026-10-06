import MarketingLayout from '../../components/marketing/MarketingLayout.js';
import {
  CtaBand,
  FeatureBlock,
  RelatedPages,
  SectionHeading,
} from '../../components/marketing/ui.js';
import { ConvoyVisual, OpsVisual } from '../../components/marketing/visuals.js';
import { getPageSeo } from '../../lib/seo/pages.js';

const PAGE = getPageSeo('/convoy-management');

export default function ConvoyManagement(): React.ReactElement {
  return (
    <MarketingLayout page={PAGE}>
      <header className="hero hero-compact">
        <div className="hero-badge">
          <i aria-hidden="true" /> Convoy Management
        </div>
        <h1>
          Run the road with
          the corridor in view.
        </h1>
        <p className="hero-lead">
          Sonalit gives convoy operations a common operational grammar: planned route, time-aware corridor adherence, route-risk context, CFO activity, seal integrity, evidence and response remain attached to the same journey when conditions change.
        </p>
      </header>

      <section className="section section-tight" aria-label="Convoy capabilities">
        <FeatureBlock
          title="A corridor is a condition, not a line on a map"
          body="The movement is evaluated against both geometry and schedule. Route deviation, being ahead or behind plan, and material corridor departure become operational events rather than visual ambiguities."
          points={[
            'Planned route and corridor captured before dispatch',
            'Time-aware corridor evaluation for off-route and schedule deviation',
            'Risk-ranked route alternatives before dispatch',
            'Seal integrity and evidence recorded per convoy truck',
          ]}
          visual={<ConvoyVisual />}
          visualLabel="Corridor Watch"
        />

        <FeatureBlock
          flip
          title="The field officer is part of the system"
          body="CFOs work from a purpose-built field surface rather than a reduced control-room dashboard. Their checks, photographs, day-plan progress and escalations become part of the same evidentiary thread the desk reads."
          points={[
            'Dedicated CFO mobile workflow',
            'Field checks, route waypoints, photos and status updates',
            'Two-way operational broadcasts and communications',
            'Panic escalation with convoy and location context',
          ]}
          visual={<OpsVisual />}
          visualLabel="Field Coordination"
        />
      </section>

      <section className="section" aria-labelledby="reporting-heading">
        <SectionHeading
          id="reporting-heading"
          label="Operational reporting"
          title="The report is a by-product of the movement"
          desc="Daily and per-convoy reports are assembled from recorded movement, checks, photos, seals, alerts and incidents. The report follows the operation; the operation does not stop to recreate the report."
        />
        <p className="prose prose-after">
          The same vehicles are managed day to day through{' '}
          <a className="inline-link" href="/fleet-management">fleet management</a>, and convoy alerts land in
          the same queue described under{' '}
          <a className="inline-link" href="/security-operations">security operations</a>.
        </p>
      </section>

      <CtaBand
        title="Run the convoy with the operational picture intact"
        body="Plan, route, escort, monitor, communicate and prove the movement from one operational record."
      />
      <RelatedPages currentPath="/convoy-management" />
    </MarketingLayout>
  );
}
