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
          See the fleet as a live operational system.
          
        </h1>
        <p className="hero-lead">
          Sonalit treats vehicle movement as a stateful operational record: live position, driver and device identity, journey history, signal health, geofences and replay remain connected to the asset instead of dissolving into isolated tracking events.
        </p>
      </header>

      <section className="section section-tight" aria-label="Fleet capabilities">
        <FeatureBlock
          title="A live picture with memory"
          body="Position is only the beginning. Sonalit carries each fix into the tactical map, event stream, geofence logic and journey history, while preserving enough context to reconstruct the movement later."
          points={[
            'Live GPS and tactical fleet mapping',
            'Historical trail retained with the journey',
            'Drive and operations replay for reconstruction',
            'Geofence and route-aware events surfaced automatically',
          ]}
          visual={<OpsVisual />}
          visualLabel="Live Fleet Map"
        />

        <FeatureBlock
          flip
          title="The operational graph behind the map"
          body="A coordinate without identity is an orphaned fact. Sonalit binds the vehicle to the driver, device, shift and operational history that make movement actionable."
          points={[
            'Vehicle records with registration, type and assignment',
            'Driver records, contact details and current assignment',
            'Tracking devices and signal state linked to the assigned vehicle',
            'Shift planning and driver assignment',
          ]}
          visual={<FleetVisual />}
          visualLabel="Fleet Register"
        />
      </section>

      <section className="section" aria-labelledby="upkeep-heading">
        <SectionHeading
          id="upkeep-heading"
          label="Maintenance &amp; cost"
          title="Condition, cost and accountability alongside movement"
          desc="Maintenance, fuel and claims sit beside movement, giving operations and management one continuity from utilisation to upkeep to incident history."
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
        title="Run the fleet from one operational picture"
        body="From live movement to maintenance, fuel, shifts, claims and reporting, Sonalit keeps the fleet legible as an operational system rather than a collection of disconnected registers."
      />
      <RelatedPages currentPath="/fleet-management" />
    </MarketingLayout>
  );
}
