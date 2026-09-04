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

const PAGE = getPageSeo('/about');

export default function About(): React.ReactElement {
  return (
    <MarketingLayout page={PAGE}>
      <section aria-labelledby="about-hero" className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_55%_at_15%_0%,rgba(255,122,0,0.10),transparent_70%)]"
        />
        <div className="relative mx-auto max-w-7xl px-5 pb-16 pt-16 lg:px-8 lg:pb-24 lg:pt-24">
          <Eyebrow>About Sonalit</Eyebrow>
          <h1
            id="about-hero"
            className="max-w-3xl text-[34px] font-bold leading-[1.1] tracking-[-0.03em] text-d-t1 sm:text-[46px]"
          >
            Operations technology for fleets, convoys and container logistics
          </h1>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-d-t2">
            Sonalit is built for organisations that move goods and have to answer for them — where
            the vehicle, the escort, the container and the customer are all part of the same job,
            and the tools for each are usually not.
          </p>
        </div>
      </section>

      <Section labelledBy="why-heading" tone="carbon">
        <SectionHeading
          id="why-heading"
          eyebrow="Why Sonalit exists"
          title="Logistics operations are one problem, not four tools"
          lede="Most operations we see run a tracking product, a spreadsheet for containers, a messaging group for the field and a reporting pack assembled by hand at month end. None of them agree, and the reconciliation work is the job."
        />
        <p className="mt-8 max-w-3xl text-[16px] leading-relaxed text-d-t2">
          Sonalit was built as one platform over one operational record. A vehicle tracked on the
          fleet map is the same vehicle running tonight's convoy and carrying tomorrow's container.
          An alert raised by a geofence, a panic signal from a field officer and a delivery
          confirmation from a yard crew all land in the same system, against the same objects, with
          the same audit trail behind them.
        </p>
      </Section>

      <Section labelledBy="who-heading">
        <SectionHeading
          id="who-heading"
          eyebrow="Who it is for"
          title="Built for the people actually running the operation"
          lede="Each role gets a surface designed for the work it does, rather than one dashboard that everybody has to tolerate."
        />
        <FeatureGrid>
          <FeatureCard
            title="Control room operators"
            body="A live operations view with the map, the alert queue and the incident record in one place."
          />
          <FeatureCard
            title="Convoy field officers"
            body="A mobile companion for running a convoy from the road: checks, photos, status and escalation."
          />
          <FeatureCard
            title="Yard and port crews"
            body="Device-paired field applications for container movements, e-lock operations and handovers."
          />
          <FeatureCard
            title="Fleet and logistics managers"
            body="Maintenance, fuel, shifts, utilisation and reporting over the same live operational data."
          />
          <FeatureCard
            title="Security and response teams"
            body="Alerting, panic escalation, geofencing and incident handling with the operational context attached."
          />
          <FeatureCard
            title="Cargo owners"
            body="A scoped client portal covering only their own shipments: tracking, manifest and delivery record."
          />
        </FeatureGrid>
      </Section>

      <Section labelledBy="how-heading" tone="carbon">
        <SectionHeading
          id="how-heading"
          eyebrow="How it is built"
          title="A multi-tenant platform with isolation at the data layer"
          lede="Sonalit is engineered as a multi-tenant system: organisations share the platform, never each other's data. Isolation is enforced in the database itself, and access inside an organisation is decided by role."
        />
        <CapabilityList
          items={[
            'Per-organisation data isolation enforced at the database layer',
            'Role-based access control across every operational surface',
            'Separate authentication for operators, field crews and cargo owners',
            'Real-time delivery of telemetry, alerts and field activity to the browser',
            'Installable mobile applications for field and handover teams',
            'Operational history retained for reporting and after-action review',
          ]}
        />
      </Section>

      <CtaBand
        title="Talk to us about your operation"
        body="If you move vehicles, convoys or containers and want them in one system, we would like to hear how you run today. If your organisation is already on Sonalit, sign in to the platform."
        primaryLabel="Sign in to Sonalit"
        secondaryLabel="Contact the Sonalit team"
      />
      <RelatedPages currentPath="/about" />
    </MarketingLayout>
  );
}
