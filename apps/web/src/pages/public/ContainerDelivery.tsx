import MarketingLayout from '../../components/marketing/MarketingLayout.js';
import {
  CtaBand,
  FeatureBlock,
  RelatedPages,
  SectionHeading,
} from '../../components/marketing/ui.js';
import { ContainerVisual, OpsVisual } from '../../components/marketing/visuals.js';
import { getPageSeo } from '../../lib/seo/pages.js';

const PAGE = getPageSeo('/container-delivery');

export default function ContainerDelivery(): React.ReactElement {
  return (
    <MarketingLayout page={PAGE}>
      <header className="hero hero-compact">
        <div className="hero-badge">
          <i aria-hidden="true" /> Container Delivery System
        </div>
        <h1>
          Container delivery, from booking to{' '}
          <span className="grad">proof of delivery</span>
        </h1>
        <p className="hero-lead">
          The Container Delivery System is Sonalit&apos;s container logistics surface. It covers the
          work between the port, the yard and the customer: what was booked, which container moved,
          who clamped and released the lock, and what was signed for at the door.
        </p>
      </header>

      <section className="section section-tight" aria-label="Container delivery capabilities">
        <FeatureBlock
          title="The container record everything else hangs off"
          body="Containers, bookings, transporters and drivers are managed together, so a container in the yard is always connected to the booking that put it there and the transporter moving it."
          points={[
            'Container register with current status and location',
            'Booking workflows from creation through allocation',
            'Transporter, haulier and driver records',
            'Trip lifecycle from allocation to delivered',
          ]}
          visual={<ContainerVisual />}
          visualLabel="Yard &amp; Custody"
        />

        <FeatureBlock
          flip
          title="Applications for the crews doing the work"
          body="Yard and port teams sign in on their own device-paired application with a per-worker PIN — separate from the operator dashboard, because a yard tablet should not need an operator account to open."
          points={[
            'Dedicated yard and port field applications',
            'Device pairing plus per-worker PIN sign-in',
            'Container movements confirmed where they happen',
            'Handover flows for transferring custody',
          ]}
          visual={<OpsVisual />}
          visualLabel="Port &amp; Yard Ops"
        />
      </section>

      <section className="section" aria-labelledby="elock-heading">
        <SectionHeading
          id="elock-heading"
          label="E-lock &amp; traceability"
          title="Clamping, unclamping and the record it leaves"
          desc="Electronic locks fitted to containers are operated through the platform rather than out of band. Each action is attached to the container, the trip and the person who performed it."
        />
        <div className="cap-grid cap-grid-3">
          <article className="cap">
            <div className="cap-icon" aria-hidden="true">⚿</div>
            <h3>E-lock operations</h3>
            <p>Clamp and unclamp performed as part of the trip they belong to, so lock state is part of the container&apos;s operational record.</p>
          </article>
          <article className="cap">
            <div className="cap-icon" aria-hidden="true">✓</div>
            <h3>Proof of delivery</h3>
            <p>Delivery confirmation captured at the point of handover and attached to the container and booking it completes.</p>
          </article>
          <article className="cap">
            <div className="cap-icon" aria-hidden="true">⛓</div>
            <h3>Custody chain</h3>
            <p>Custody events recorded in sequence, so who held the container and when can be reconstructed afterwards.</p>
          </article>
        </div>
        <p className="prose prose-after">
          Container movements use the same tracked vehicles described under{' '}
          <a className="inline-link" href="/fleet-management">fleet management</a>, and high-value moves are
          frequently run as escorted{' '}
          <a className="inline-link" href="/convoy-management">convoys</a>.
        </p>
      </section>

      <CtaBand
        title="Trace every container from booking to delivery"
        body="Bookings, e-lock workflows, yard and port coordination and proof of delivery in one system."
      />
      <RelatedPages currentPath="/container-delivery" />
    </MarketingLayout>
  );
}
