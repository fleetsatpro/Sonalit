import MarketingLayout from '../../components/marketing/MarketingLayout.js';
import {
  CapabilityList,
  CtaBand,
  Eyebrow,
  FeatureCard,
  FeatureGrid,
  RelatedPages,
  Section,
  SectionHeading,
} from '../../components/marketing/ui.js';
import { getPageSeo } from '../../lib/seo/pages.js';

const PAGE = getPageSeo('/fleet-management');

export default function FleetManagement(): React.ReactElement {
  return (
    <MarketingLayout page={PAGE}>
      <section aria-labelledby="fleet-hero" className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_55%_at_15%_0%,rgba(255,122,0,0.11),transparent_70%)]"
        />
        <div className="relative mx-auto max-w-7xl px-5 pb-16 pt-16 lg:px-8 lg:pb-24 lg:pt-24">
          <Eyebrow>Fleet management</Eyebrow>
          <h1
            id="fleet-hero"
            className="max-w-3xl text-[34px] font-bold leading-[1.1] tracking-[-0.03em] text-d-t1 sm:text-[46px]"
          >
            Fleet management built around live vehicle operations
          </h1>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-d-t2">
            Sonalit keeps vehicles, drivers, devices and journeys in one operational record. Where a
            vehicle is, who is driving it, when it is next due for service and what it has cost to
            run are all answered from the same live data set — not from three spreadsheets that
            disagree.
          </p>
        </div>
      </section>

      <Section labelledBy="visibility-heading" tone="carbon">
        <SectionHeading
          id="visibility-heading"
          eyebrow="Fleet visibility"
          title="One live view of the whole fleet"
          lede="Tracked vehicles report position continuously, and those positions drive the map, the dashboards and the alerting rules at the same time. Operators watch one screen instead of reconciling several."
        />
        <FeatureGrid>
          <FeatureCard
            title="Live map"
            body="Every tracked vehicle on a single map with its current position, recent movement and the geofences it is interacting with."
          />
          <FeatureCard
            title="Journey history"
            body="Completed journeys are retained with their position trail, so a route taken last week can be reviewed as easily as one running now."
          />
          <FeatureCard
            title="Drive replay"
            body="Replay a journey against the map to see how it actually unfolded, rather than inferring it from a list of coordinates."
          />
        </FeatureGrid>
      </Section>

      <Section labelledBy="assets-heading">
        <SectionHeading
          id="assets-heading"
          eyebrow="Vehicles &amp; drivers"
          title="The register behind the map"
          lede="A position on a map is only useful next to the vehicle it belongs to. Sonalit keeps the operational registers that give a track meaning."
        />
        <CapabilityList
          items={[
            'Vehicle records with registration, type and assignment',
            'Driver records, contact details and current assignment',
            'Tracking devices linked to the vehicle they are fitted to',
            'Shift management and driver rostering',
            'Vehicle detail views that pull together journeys, alerts and documents',
            'Bulk-friendly data views for large fleets',
          ]}
        />
      </Section>

      <Section labelledBy="upkeep-heading" tone="carbon">
        <SectionHeading
          id="upkeep-heading"
          eyebrow="Maintenance &amp; fuel"
          title="Cost and condition tracked alongside movement"
          lede="Maintenance and fuel are recorded against the same vehicle record the tracking uses, so cost per vehicle and service history sit next to how that vehicle is actually being used."
        />
        <FeatureGrid>
          <FeatureCard
            title="Maintenance scheduling"
            body="Service intervals and completed work recorded per vehicle, so upcoming maintenance is visible before it becomes a breakdown."
          />
          <FeatureCard
            title="Fuel records"
            body="Fuel entries captured against vehicles and journeys, giving consumption a denominator that reflects real distance covered."
          />
          <FeatureCard
            title="Claims and incidents"
            body="Damage, claims and incidents attached to the vehicle they concern, keeping the history in one place for review."
          />
        </FeatureGrid>
      </Section>

      <Section labelledBy="dashboards-heading">
        <SectionHeading
          id="dashboards-heading"
          eyebrow="Operational dashboards"
          title="Reporting that comes out of the operation"
          lede="Analytics and reports are generated from the same records operators work in daily, so what a manager reviews at the end of the month is the same data the control room used during it."
        />
        <CapabilityList
          items={[
            'Fleet dashboards showing current operational state',
            'Analytics across journeys, utilisation and activity',
            'Exportable reports for internal and customer review',
            'Executive views summarising fleet performance',
            'Alert and rule engines that surface exceptions automatically',
            'Historical data retained for period-on-period comparison',
          ]}
        />
        <p className="mt-8 text-[15px] leading-relaxed text-d-t2">
          Fleets that also move escorted or high-value cargo usually run the same vehicles through{' '}
          <a href="/convoy-management" className="font-semibold text-cds-orange hover:underline">
            convoy management
          </a>{' '}
          and monitor them from{' '}
          <a href="/security-operations" className="font-semibold text-cds-orange hover:underline">
            security operations
          </a>
          .
        </p>
      </Section>

      <CtaBand
        title="Run your fleet from one live operational picture"
        body="Sonalit is used by operations teams who need vehicle tracking, driver management and fleet reporting to be the same system. Sign in if your organisation already has access, or get in touch about setting it up."
      />
      <RelatedPages currentPath="/fleet-management" />
    </MarketingLayout>
  );
}
