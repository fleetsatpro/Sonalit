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

const PAGE = getPageSeo('/security-operations');

export default function SecurityOperations(): React.ReactElement {
  return (
    <MarketingLayout page={PAGE}>
      <section aria-labelledby="secops-hero" className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_55%_at_15%_0%,rgba(255,59,92,0.09),transparent_70%)]"
        />
        <div className="relative mx-auto max-w-7xl px-5 pb-16 pt-16 lg:px-8 lg:pb-24 lg:pt-24">
          <Eyebrow>Security operations</Eyebrow>
          <h1
            id="secops-hero"
            className="max-w-3xl text-[34px] font-bold leading-[1.1] tracking-[-0.03em] text-d-t1 sm:text-[46px]"
          >
            Fleet and security operations in one control room
          </h1>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-d-t2">
            Monitoring is only useful if something happens when a condition is met. Sonalit turns
            positions, geofences, device signals and field reports into alerts an operator can act
            on, and keeps the response attached to the event that triggered it.
          </p>
        </div>
      </section>

      <Section labelledBy="monitoring-heading" tone="carbon">
        <SectionHeading
          id="monitoring-heading"
          eyebrow="Operational monitoring"
          title="Continuous watch over vehicles, convoys and crews"
          lede="Telemetry arrives continuously and is evaluated as it lands. Operators watch a queue that fills itself instead of scanning a map hoping to notice something."
        />
        <FeatureGrid>
          <FeatureCard
            title="Live operational feed"
            body="Alerts, incidents and field activity arrive in one chronological stream, pushed to the browser as they happen."
          />
          <FeatureCard
            title="Rule engine"
            body="Conditions that matter to your operation are expressed as rules, and matching events raise alerts automatically."
          />
          <FeatureCard
            title="Signal health"
            body="Devices that stop reporting are surfaced as a problem in their own right, rather than being silently absent from the map."
          />
        </FeatureGrid>
      </Section>

      <Section labelledBy="geo-heading">
        <SectionHeading
          id="geo-heading"
          eyebrow="Geofencing &amp; corridors"
          title="Geography as an operational control"
          lede="Depots, checkpoints, customer sites and restricted ground are drawn once and then enforced continuously — entry, exit and corridor departure all become events with a time and an owner."
        />
        <CapabilityList
          items={[
            'Geofence definition and management per organisation',
            'Entry and exit events raised automatically',
            'Corridor evaluation against a journey’s planned route',
            'Route risk analysis used at planning time',
            'Risk intelligence gathered from open sources',
            'Map-based investigation of where events occurred',
          ]}
        />
      </Section>

      <Section labelledBy="incident-heading" tone="carbon">
        <SectionHeading
          id="incident-heading"
          eyebrow="Incident response"
          title="From signal to response, with the trail intact"
          lede="An alert, an incident and the response to it stay connected. What was raised, who acknowledged it, what was done and how it resolved are one record — which is also what makes an after-action review possible."
        />
        <FeatureGrid>
          <FeatureCard
            title="Alert and incident queue"
            body="A single prioritised queue for everything requiring attention, with the vehicle, convoy or container context attached."
          />
          <FeatureCard
            title="Panic escalation"
            body="Panic signals from field devices escalate immediately and audibly to operators, carrying the location they were sent from."
          />
          <FeatureCard
            title="Field crew coordination"
            body="Response crews work from their own application and report back into the same incident the control room is handling."
          />
          <FeatureCard
            title="Device agent monitoring"
            body="Guardian device agents report status and signal anomalies, so a compromised or silent device is itself an event."
          />
          <FeatureCard
            title="Broadcast messaging"
            body="Operators can reach drivers, field officers and crews directly from the operations surface during an incident."
          />
          <FeatureCard
            title="Incident history"
            body="Closed incidents are retained with their full context for review, reporting and pattern analysis."
          />
        </FeatureGrid>
      </Section>

      <Section labelledBy="awareness-heading">
        <SectionHeading
          id="awareness-heading"
          eyebrow="Situational awareness"
          title="Everyone looking at the same picture"
          lede="Control room operators, convoy field officers, yard crews and response teams each work in the surface built for their role, but all of them read and write the same underlying operational record."
        />
        <p className="mt-8 text-[15px] leading-relaxed text-d-t2">
          Security operations sit on top of the same data as{' '}
          <a href="/fleet-management" className="font-semibold text-cds-orange hover:underline">
            fleet management
          </a>
          ,{' '}
          <a href="/convoy-management" className="font-semibold text-cds-orange hover:underline">
            convoy management
          </a>{' '}
          and{' '}
          <a href="/container-delivery" className="font-semibold text-cds-orange hover:underline">
            container delivery
          </a>
          .
        </p>
      </Section>

      <CtaBand
        title="Give your control room something to act on"
        body="Sonalit turns tracking data and field reports into alerts, incidents and a response record. Sign in if you already have access, or contact us to discuss your operation."
      />
      <RelatedPages currentPath="/security-operations" />
    </MarketingLayout>
  );
}
