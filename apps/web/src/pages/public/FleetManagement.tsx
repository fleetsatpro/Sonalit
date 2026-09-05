import MarketingLayout from '../../components/marketing/MarketingLayout.js';
import {
  CtaBand,
  FeatureBlock,
  RelatedPages,
  SectionHeading,
} from '../../components/marketing/ui.js';
import { FleetVisual, OpsVisual } from '../../components/marketing/visuals.js';
import { getPageSeo } from '../../lib/seo/pages.js';

const PAGE = getPageSeo('/fleet-management');

export default function FleetManagement(): React.ReactElement {
  return (
    <MarketingLayout page={PAGE}>
      <header className="hero hero-compact">
        <div className="hero-badge">
          <i aria-hidden="true" /> Fleet Management
        </div>
        <h1>
          Fleet management built around{' '}
          <span className="grad">live vehicle operations</span>
        </h1>
        <p className="hero-lead">
          Sonalit keeps vehicles, drivers, devices and journeys in one operational record. Where a
          vehicle is, who is driving it, when it is next due for service and what it costs to run
          are answered from the same live data set — not from three spreadsheets that disagree.
        </p>
      </header>

      <section className="section section-tight" aria-label="Fleet capabilities">
        <FeatureBlock
          title="One live view of the whole fleet"
          body="Tracked vehicles report position continuously, and those positions drive the map, the dashboards and the alerting rules at the same time. Operators watch one screen instead of reconciling several."
          points={[
            'Live map of every tracked vehicle',
            'Journey history retained with its position trail',
            'Drive replay to reconstruct what actually happened',
            'Geofence events raised automatically',
          ]}
          visual={<OpsVisual />}
          visualLabel="Live Fleet Map"
        />

        <FeatureBlock
          flip
          title="The register behind the map"
          body="A position is only useful next to the vehicle it belongs to. Sonalit holds the operational registers that give a track meaning."
          points={[
            'Vehicle records with registration, type and assignment',
            'Driver records, contact details and current assignment',
            'Tracking devices linked to the vehicle they are fitted to',
            'Shift management and driver rostering',
          ]}
          visual={<FleetVisual />}
          visualLabel="Fleet Register"
        />
      </section>

      <section className="section" aria-labelledby="upkeep-heading">
        <SectionHeading
          id="upkeep-heading"
          label="Maintenance &amp; cost"
          title="Condition and cost tracked alongside movement"
          desc="Maintenance and fuel are recorded against the same vehicle record the tracking uses, so cost per vehicle sits next to how that vehicle is actually being used."
        />
        <div className="cap-grid cap-grid-3">
          <article className="cap">
            <div className="cap-icon" aria-hidden="true">⚙</div>
            <h3>Maintenance scheduling</h3>
            <p>Service intervals and completed work recorded per vehicle, so upcoming maintenance is visible before it becomes a breakdown.</p>
          </article>
          <article className="cap">
            <div className="cap-icon" aria-hidden="true">◧</div>
            <h3>Fuel records</h3>
            <p>Fuel entries captured against vehicles and journeys, giving consumption a denominator that reflects real distance covered.</p>
          </article>
          <article className="cap">
            <div className="cap-icon" aria-hidden="true">◑</div>
            <h3>Claims and incidents</h3>
            <p>Damage, claims and incidents attached to the vehicle they concern, keeping the history in one place for review.</p>
          </article>
        </div>
        <p className="prose prose-after">
          Fleets that also move escorted or high-value cargo usually run the same vehicles through{' '}
          <a className="inline-link" href="/convoy-management">convoy management</a> and monitor them from{' '}
          <a className="inline-link" href="/security-operations">security operations</a>.
        </p>
      </section>

      <CtaBand
        title="Run your fleet from one live picture"
        body="Sonalit is built for operations teams who need vehicle tracking, driver management and fleet reporting to be the same system."
      />
      <RelatedPages currentPath="/fleet-management" />
    </MarketingLayout>
  );
}
