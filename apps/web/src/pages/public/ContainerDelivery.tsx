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

const PAGE = getPageSeo('/container-delivery');

export default function ContainerDelivery(): React.ReactElement {
  return (
    <MarketingLayout page={PAGE}>
      <section aria-labelledby="cds-hero" className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_55%_at_15%_0%,rgba(255,122,0,0.10),transparent_70%)]"
        />
        <div className="relative mx-auto max-w-7xl px-5 pb-16 pt-16 lg:px-8 lg:pb-24 lg:pt-24">
          <Eyebrow>Container Delivery System</Eyebrow>
          <h1
            id="cds-hero"
            className="max-w-3xl text-[34px] font-bold leading-[1.1] tracking-[-0.03em] text-d-t1 sm:text-[46px]"
          >
            Container delivery, from booking to proof of delivery
          </h1>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-d-t2">
            The Container Delivery System is Sonalit's container logistics surface. It covers the
            work between the port, the yard and the customer: what was booked, which container
            moved, who clamped and released the lock, and what was signed for at the door.
          </p>
        </div>
      </section>

      <Section labelledBy="bookings-heading" tone="carbon">
        <SectionHeading
          id="bookings-heading"
          eyebrow="Bookings &amp; containers"
          title="The container record everything else hangs off"
          lede="Containers, bookings, transporters and drivers are managed together, so a container in the yard is always connected to the booking that put it there and the transporter moving it."
        />
        <CapabilityList
          items={[
            'Container register with current status and location',
            'Booking workflows from creation through allocation',
            'Transporter and haulier records',
            'Driver assignment for each container movement',
            'Trip lifecycle states from allocation to delivered',
            'Container and booking data views built for daily operational use',
          ]}
        />
      </Section>

      <Section labelledBy="elock-heading">
        <SectionHeading
          id="elock-heading"
          eyebrow="E-lock operations"
          title="Clamping and unclamping as recorded operations"
          lede="Electronic locks fitted to containers are operated through the platform rather than out of band. Each clamp and unclamp is an authorised action attached to the container, the trip and the person who performed it."
        />
        <FeatureGrid>
          <FeatureCard
            title="Clamp and unclamp workflows"
            body="Lock operations are performed as part of the trip they belong to, so the container's lock state is part of its operational record."
          />
          <FeatureCard
            title="Authorised operation"
            body="Lock actions are tied to an authenticated crew member and their role, not to whoever is holding a device."
          />
          <FeatureCard
            title="Lock state visibility"
            body="Operators can see the current lock state of a container alongside where it is and which trip it is on."
          />
        </FeatureGrid>
      </Section>

      <Section labelledBy="yard-heading" tone="carbon">
        <SectionHeading
          id="yard-heading"
          eyebrow="Yard &amp; port coordination"
          title="Applications for the crews doing the work"
          lede="Yard and port teams sign in on their own device-paired application with a per-worker PIN — separate from the operator dashboard, because a yard tablet should not need an operator account to open."
        />
        <CapabilityList
          items={[
            'Dedicated yard and port field applications',
            'Device pairing plus per-worker PIN sign-in',
            'Role-appropriate screens for yard versus port crews',
            'Container movements confirmed at the point they happen',
            'Handover flows for transferring custody between teams',
            'Mobile-first interaction designed for gloved, outdoor use',
          ]}
        />
      </Section>

      <Section labelledBy="pod-heading">
        <SectionHeading
          id="pod-heading"
          eyebrow="Proof of delivery &amp; traceability"
          title="A custody record the customer can be shown"
          lede="Each handover is recorded as it occurs, producing a chain that runs from the yard to the delivery point. Cargo owners get their own portal view of the shipments that belong to them, without access to anything else in the platform."
        />
        <FeatureGrid>
          <FeatureCard
            title="Proof of delivery"
            body="Delivery confirmation captured at the point of handover and attached to the container and booking it completes."
          />
          <FeatureCard
            title="Custody chain"
            body="Custody events are recorded in sequence, so who held the container and when can be reconstructed after the fact."
          />
          <FeatureCard
            title="Cargo owner portal"
            body="Clients see the manifest, tracking and delivery record for their own shipments through a separate, scoped portal."
          />
        </FeatureGrid>
        <p className="mt-10 text-[15px] leading-relaxed text-d-t2">
          Container movements use the same tracked vehicles described under{' '}
          <a href="/fleet-management" className="font-semibold text-cds-orange hover:underline">
            fleet management
          </a>
          , and high-value container moves are frequently run as escorted{' '}
          <a href="/convoy-management" className="font-semibold text-cds-orange hover:underline">
            convoys
          </a>
          .
        </p>
      </Section>

      <CtaBand
        title="Trace every container from booking to delivery"
        body="Sonalit's Container Delivery System is already in operational use for container bookings, e-lock workflows and proof of delivery. Sign in, or contact us about running it for your operation."
      />
      <RelatedPages currentPath="/container-delivery" />
    </MarketingLayout>
  );
}
