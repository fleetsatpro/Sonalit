import MarketingLayout from '../../components/marketing/MarketingLayout.js';
import {
  CtaBand,
  FeatureBlock,
  RelatedPages,
  SectionHeading,
} from '../../components/marketing/ui.js';
import { ConvoyVisual, SecurityVisual } from '../../components/marketing/visuals.js';
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
          Convoy management and{' '}
          <span className="grad">field security operations</span>
        </h1>
        <p className="hero-lead">
          A convoy is more than a group of vehicles: it has a route, an escort, a cargo, a set of
          checks and a reporting obligation. Sonalit treats it as one object from planning through
          arrival, so the control room and the officers on the road are never working from
          different versions of the same journey.
        </p>
      </header>

      <section className="section section-tight" aria-label="Convoy capabilities">
        <FeatureBlock
          title="Watch the corridor, not just the dot"
          body="Convoy positions are evaluated against the corridor they are supposed to be in and the risk profile of the ground they are covering, so operators are alerted to the situation rather than left to interpret a map."
          points={[
            'Planned route and corridor recorded at creation',
            'Corridor departure raises an alert, not a surprise',
            'Route risk assessed before dispatch',
            'Seal integrity checks recorded against the convoy',
          ]}
          visual={<ConvoyVisual />}
          visualLabel="Corridor Watch"
        />

        <FeatureBlock
          flip
          title="Built for the officer on the road, too"
          body="Convoy field officers work from a mobile surface designed for their job — not a shrunken operator dashboard. What they submit from the road becomes the record the control room reads."
          points={[
            'A dedicated convoy companion application',
            'Checks, photos and status submitted from the journey',
            'Two-way messaging with the control room',
            'Panic escalation with the convoy context attached',
          ]}
          visual={<SecurityVisual />}
          visualLabel="Field Coordination"
        />
      </section>

      <section className="section" aria-labelledby="reporting-heading">
        <SectionHeading
          id="reporting-heading"
          label="Operational reporting"
          title="A convoy report that writes itself"
          desc="Daily and per-convoy reports are assembled from what was actually recorded during the journey — positions, checks, photos, alerts and incidents — so reporting is a by-product of running the operation rather than a separate task."
        />
        <p className="prose prose-after">
          The same vehicles are managed day to day through{' '}
          <a className="inline-link" href="/fleet-management">fleet management</a>, and convoy alerts land in
          the same queue described under{' '}
          <a className="inline-link" href="/security-operations">security operations</a>.
        </p>
      </section>

      <CtaBand
        title="Run convoys with the corridor under watch"
        body="Plan, escort, monitor and report on every movement from a single operational record."
      />
      <RelatedPages currentPath="/convoy-management" />
    </MarketingLayout>
  );
}
