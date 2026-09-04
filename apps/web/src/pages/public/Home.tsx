import MarketingLayout from '../../components/marketing/MarketingLayout.js';
import { PLATFORM_LINKS } from '../../components/marketing/nav.js';
import {
  CapabilityList,
  CtaBand,
  Eyebrow,
  FeatureCard,
  FeatureGrid,
  Section,
  SectionHeading,
} from '../../components/marketing/ui.js';
import { getPageSeo } from '../../lib/seo/pages.js';

const PAGE = getPageSeo('/');

export default function Home(): React.ReactElement {
  return (
    <MarketingLayout page={PAGE}>
      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section aria-labelledby="hero-heading" className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,rgba(255,122,0,0.13),transparent_70%)]"
        />
        <div className="relative mx-auto max-w-7xl px-5 pb-20 pt-20 lg:px-8 lg:pb-28 lg:pt-28">
          <div className="max-w-3xl">
            <Eyebrow>Fleet · Convoy · Container logistics</Eyebrow>
            <h1
              id="hero-heading"
              className="text-[36px] font-bold leading-[1.08] tracking-[-0.03em] text-d-t1 sm:text-[52px] lg:text-[60px]"
            >
              Intelligent fleet, convoy and logistics operations
            </h1>
            <p className="mt-7 max-w-2xl text-[17px] leading-relaxed text-d-t2 sm:text-[18.5px]">
              Sonalit brings vehicle tracking, convoy security, container delivery and incident
              response into a single operations platform — so the people running a corridor, a yard
              and a control room are all working from the same live picture.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <a
                href="/login"
                className="rounded-md bg-cds-orange px-6 py-3.5 text-[15px] font-semibold text-[#170900] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cds-orange"
              >
                Open the operations platform
              </a>
              <a
                href="/contact"
                className="rounded-md border border-d-rim2 px-6 py-3.5 text-[15px] font-semibold text-d-t1 transition-colors hover:border-cds-orange hover:text-cds-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cds-orange"
              >
                Request platform access
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Platform overview ───────────────────────────────────────────── */}
      <Section labelledBy="platform-heading" tone="carbon">
        <SectionHeading
          id="platform-heading"
          eyebrow="Platform overview"
          title="One platform, four operating surfaces"
          lede="Most logistics teams run tracking, security and container work in separate tools that never agree with each other. Sonalit models them as one operation: shared vehicles, shared geography, shared alerts, shared audit trail."
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {PLATFORM_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="group rounded-xl border border-d-rim bg-d-deep/70 p-7 transition-colors hover:border-cds-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cds-orange"
            >
              <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-d-t1 group-hover:text-cds-orange">
                {link.label}
              </h3>
              <p className="mt-3 text-[14.5px] leading-relaxed text-d-t2">{link.blurb}</p>
            </a>
          ))}
        </div>
      </Section>

      {/* ── Fleet operations ────────────────────────────────────────────── */}
      <Section labelledBy="fleet-heading">
        <SectionHeading
          id="fleet-heading"
          eyebrow="Fleet operations"
          title="Know where every vehicle is, and what it is doing"
          lede="Vehicles, drivers, devices and journeys live in one record set. Positions stream in continuously, so the fleet view is the operational truth rather than a report written after the fact."
        />
        <CapabilityList
          items={[
            'Live GPS tracking with journey history and drive replay',
            'Vehicle, driver and device registers kept in one place',
            'Maintenance schedules and service history per vehicle',
            'Fuel records and consumption tracking',
            'Shift and driver assignment management',
            'Fleet dashboards, analytics and exportable reports',
          ]}
        />
        <p className="mt-8">
          <a
            href="/fleet-management"
            className="text-[14.5px] font-semibold text-cds-orange hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cds-orange"
          >
            Explore fleet management in Sonalit →
          </a>
        </p>
      </Section>

      {/* ── Convoy & security operations ────────────────────────────────── */}
      <Section labelledBy="convoy-heading" tone="carbon">
        <SectionHeading
          id="convoy-heading"
          eyebrow="Convoy &amp; security operations"
          title="Move high-value cargo with the corridor under watch"
          lede="A convoy is planned, staffed, escorted and reported as one object. Field officers on the ground and operators in the control room work the same convoy record from opposite ends."
        />
        <FeatureGrid>
          <FeatureCard
            title="Convoy planning"
            body="Build a convoy from vehicles, drivers and cargo, assign the field officers who will run it, and set the route it is expected to follow."
          />
          <FeatureCard
            title="Corridor monitoring"
            body="Routes are evaluated against known risk along the corridor, and departures from the planned path raise an alert rather than being discovered later."
          />
          <FeatureCard
            title="Field officer coordination"
            body="Convoy field officers report from the road on a mobile surface built for them — checks, photos and status updates land straight in the operations view."
          />
          <FeatureCard
            title="Seal and cargo integrity"
            body="Seal checks are recorded against the convoy, so an integrity break is a timestamped event with an owner instead of an argument after arrival."
          />
          <FeatureCard
            title="Incident and alert handling"
            body="Alerts, incidents and panic signals from a convoy escalate into the same queue operators already watch, with the convoy context attached."
          />
          <FeatureCard
            title="Convoy reporting"
            body="Daily and per-convoy reports are generated from what actually happened on the journey, including the photo record submitted from the field."
          />
        </FeatureGrid>
        <p className="mt-10">
          <a
            href="/convoy-management"
            className="text-[14.5px] font-semibold text-cds-orange hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cds-orange"
          >
            Explore convoy management in Sonalit →
          </a>
        </p>
      </Section>

      {/* ── Container delivery ──────────────────────────────────────────── */}
      <Section labelledBy="cds-heading">
        <SectionHeading
          id="cds-heading"
          eyebrow="Container Delivery System"
          title="Containers tracked from booking to proof of delivery"
          lede="The Container Delivery System handles the part of logistics that lives between the port, the yard and the customer: who booked what, which container moved, who unlocked it, and what was signed for on arrival."
        />
        <CapabilityList
          items={[
            'Bookings, containers, transporters and driver records',
            'Trip lifecycle from allocation through dispatch to delivery',
            'E-lock clamp and unclamp workflows on the container itself',
            'Yard and port field applications for the crews doing the work',
            'Proof of delivery captured at the point of handover',
            'A traceable custody record for each container movement',
          ]}
        />
        <p className="mt-8">
          <a
            href="/container-delivery"
            className="text-[14.5px] font-semibold text-cds-orange hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cds-orange"
          >
            Explore the Container Delivery System →
          </a>
        </p>
      </Section>

      {/* ── Real-time visibility ────────────────────────────────────────── */}
      <Section labelledBy="realtime-heading" tone="carbon">
        <SectionHeading
          id="realtime-heading"
          eyebrow="Real-time visibility"
          title="A control room that updates itself"
          lede="Telemetry, alerts and field submissions are pushed to the browser as they arrive rather than waiting for someone to refresh. Maps, queues and dashboards move together."
        />
        <FeatureGrid>
          <FeatureCard
            title="Live map"
            body="Vehicles, convoys and geofences on one map, with position updates streaming in from tracked devices as they report."
          />
          <FeatureCard
            title="Journey replay"
            body="Any completed journey can be replayed against the map to reconstruct what happened, and when, without reading raw position logs."
          />
          <FeatureCard
            title="Operational feed"
            body="Alerts, incidents and field activity arrive in a single chronological stream so nothing depends on someone happening to be on the right screen."
          />
        </FeatureGrid>
      </Section>

      {/* ── Operational intelligence ────────────────────────────────────── */}
      <Section labelledBy="intel-heading">
        <SectionHeading
          id="intel-heading"
          eyebrow="Operational intelligence"
          title="Decisions supported by the operation's own record"
          lede="Everything Sonalit records — journeys, alerts, incidents, deliveries, field reports — is available for analysis, so route, cost and risk questions are answered from operational history rather than estimates."
        />
        <CapabilityList
          items={[
            'Route and corridor risk analysis before dispatch',
            'Geofence and rule engines that turn conditions into alerts',
            'Executive and operational dashboards over live data',
            'Exportable reporting for customers and internal review',
            'Incident history retained with its full context',
            'Analytics across fleet, convoy and container activity',
          ]}
        />
      </Section>

      {/* ── Enterprise positioning ──────────────────────────────────────── */}
      <Section labelledBy="enterprise-heading" tone="carbon">
        <SectionHeading
          id="enterprise-heading"
          eyebrow="Built for enterprise operations"
          title="Multi-tenant by design, access controlled by role"
          lede="Sonalit is a multi-tenant platform: each organisation's data is isolated at the database level, and what a user can see inside their organisation is decided by their role. Field crews, convoy officers, cargo owners and operators each get their own surface rather than a shared, over-permissioned dashboard."
        />
        <FeatureGrid>
          <FeatureCard
            title="Tenant isolation"
            body="Organisation data is separated in the database itself, not only in application code, so one tenant's records stay inside that tenant."
          />
          <FeatureCard
            title="Role-based access"
            body="Operators, field officers, yard and port crews and cargo owners each authenticate into the surface built for their role."
          />
          <FeatureCard
            title="Operational audit trail"
            body="Actions and events are recorded against the vehicle, convoy or container they belong to, so an operation can be reconstructed afterwards."
          />
        </FeatureGrid>
      </Section>

      <CtaBand
        title="Bring your fleet, convoys and containers into one operation"
        body="If your organisation already uses Sonalit, sign in to the operations platform. If not, tell us how you move goods and we will get back to you about access."
        primaryLabel="Sign in to Sonalit"
        secondaryLabel="Request platform access"
      />
    </MarketingLayout>
  );
}
