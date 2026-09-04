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

const PAGE = getPageSeo('/convoy-management');

export default function ConvoyManagement(): React.ReactElement {
  return (
    <MarketingLayout page={PAGE}>
      <section aria-labelledby="convoy-hero" className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_55%_at_15%_0%,rgba(139,107,255,0.10),transparent_70%)]"
        />
        <div className="relative mx-auto max-w-7xl px-5 pb-16 pt-16 lg:px-8 lg:pb-24 lg:pt-24">
          <Eyebrow>Convoy management</Eyebrow>
          <h1
            id="convoy-hero"
            className="max-w-3xl text-[34px] font-bold leading-[1.1] tracking-[-0.03em] text-d-t1 sm:text-[46px]"
          >
            Convoy management and field security operations
          </h1>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-d-t2">
            A convoy is more than a group of vehicles: it has a route, an escort, a cargo, a set of
            checks and a reporting obligation. Sonalit treats it as one object from planning through
            arrival, so the control room and the officers on the road are never working from
            different versions of the same journey.
          </p>
        </div>
      </section>

      <Section labelledBy="planning-heading" tone="carbon">
        <SectionHeading
          id="planning-heading"
          eyebrow="Convoy planning"
          title="Plan the convoy before it leaves"
          lede="Vehicles, drivers, cargo and the officers responsible are attached to the convoy up front, and the intended route is recorded so any deviation later has something to be measured against."
        />
        <CapabilityList
          items={[
            'Convoy records built from vehicles, drivers and cargo',
            'Convoy field officer (CFO) assignment per convoy',
            'Planned route and corridor recorded at creation',
            'Route risk assessed before dispatch',
            'Truck and escort composition managed per journey',
            'Client and cargo owner context attached to the convoy',
          ]}
        />
      </Section>

      <Section labelledBy="monitoring-heading">
        <SectionHeading
          id="monitoring-heading"
          eyebrow="Convoy monitoring"
          title="Watch the corridor, not just the dot"
          lede="Convoy positions are evaluated against the corridor they are supposed to be in and the risk profile of the ground they are covering, so operators are alerted to the situation rather than left to interpret a map."
        />
        <FeatureGrid>
          <FeatureCard
            title="Corridor evaluation"
            body="The convoy's position is continuously evaluated against its planned corridor, turning a route departure into an alert instead of a discovery."
          />
          <FeatureCard
            title="Route risk ranking"
            body="Routes are scored against known risk along the way, giving planners a basis for choosing one corridor over another."
          />
          <FeatureCard
            title="Geofence rules"
            body="Zones that matter — depots, checkpoints, restricted ground — raise events when a convoy enters or leaves them."
          />
          <FeatureCard
            title="Seal integrity"
            body="Seal checks are recorded against the convoy, so a break in cargo integrity is a timestamped, attributable event."
          />
          <FeatureCard
            title="Panic escalation"
            body="A panic signal from the field escalates immediately into the operator's queue with the convoy and location attached."
          />
          <FeatureCard
            title="Live convoy view"
            body="Operators see the convoy, its vehicles and its recent events together rather than assembling the picture from separate screens."
          />
        </FeatureGrid>
      </Section>

      <Section labelledBy="field-heading" tone="carbon">
        <SectionHeading
          id="field-heading"
          eyebrow="Field coordination"
          title="Built for the officer on the road, too"
          lede="Convoy field officers work from a mobile surface designed for their job — not a shrunken operator dashboard. What they submit from the road becomes the operational record the control room reads."
        />
        <CapabilityList
          items={[
            'A dedicated convoy companion application for field officers',
            'Checks and status updates submitted from the journey itself',
            'Photo evidence captured against the convoy it belongs to',
            'Two-way messaging between field officers and operators',
            'Incident reporting from the field into the operations queue',
            'Offline-tolerant capture for stretches with poor coverage',
          ]}
        />
      </Section>

      <Section labelledBy="reporting-heading">
        <SectionHeading
          id="reporting-heading"
          eyebrow="Operational reporting"
          title="A convoy report that writes itself"
          lede="Daily and per-convoy reports are assembled from what was actually recorded during the journey — positions, checks, photos, alerts and incidents — so reporting is a by-product of running the operation rather than a separate task."
        />
        <p className="mt-8 text-[15px] leading-relaxed text-d-t2">
          The same vehicles are usually managed day to day through{' '}
          <a href="/fleet-management" className="font-semibold text-cds-orange hover:underline">
            fleet management
          </a>
          , and convoy alerts land in the same queue described under{' '}
          <a href="/security-operations" className="font-semibold text-cds-orange hover:underline">
            security operations
          </a>
          .
        </p>
      </Section>

      <CtaBand
        title="Run convoys with the corridor under continuous watch"
        body="If your organisation already runs convoys on Sonalit, sign in to the operations platform. If you are evaluating it, tell us about the corridors you move and we will follow up."
      />
      <RelatedPages currentPath="/convoy-management" />
    </MarketingLayout>
  );
}
