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
          Know the container as it moves from instruction to proof.
        </h1>
        <p className="hero-lead">
          Sonalit turns container delivery into a continuous operational record: booking, container identity, transporter, trip, lock state, yard and port activity, documents, exceptions, analytics and delivery proof remain connected from first instruction to final handover.
        </p>
      </header>

      <section className="section section-tight" aria-label="Container delivery capabilities">
        <FeatureBlock
          title="The container record is the spine of the movement"
          body="CDS keeps the entities that matter in the same graph: the booking points to the container, the container to its trip, the trip to the vehicle and driver, and every material event returns to that chain."
          points={[
            'Container inventory, status and location',
            'Booking lifecycle and container allocation',
            'Transporter, haulier and driver records',
            'Trip lifecycle through delivery, lock removal and closure',
          ]}
          visual={<ContainerVisual />}
          visualLabel="Yard &amp; Custody"
        />

        <FeatureBlock
          flip
          title="The workflow follows the physical handoff"
          body="Yard and port teams use dedicated, device-paired field applications so clamp, unclamp, departure and handover events are recorded at the point of work rather than reconstructed afterwards."
          points={[
            'Dedicated yard and port field applications',
            'Device pairing and per-worker sign-in',
            'Container movements confirmed at the point of work',
            'Custody handovers with an ordered event trail',
          ]}
          visual={<OpsVisual />}
          visualLabel="Port &amp; Yard Ops"
        />
      </section>

      <section className="section" aria-labelledby="elock-heading">
        <SectionHeading
          id="elock-heading"
          label="E-lock &amp; traceability"
          title="Electronic locks, custody and exception intelligence"
          desc="Electronic-lock state is part of the operational chronology: lock, unlock, tamper and related location evidence are tied to the container and trip, while CDS intelligence surfaces stalled, overdue and high-risk journeys and booking gaps."
        />
        <div className="cap-grid cap-grid-3">
          <article className="cap">
            <div className="cap-icon" aria-hidden="true">⚿</div>
            <h3>E-lock lifecycle</h3>
            <p>Clamp and unclamp performed as part of the trip they belong to, so lock state is part of the container&apos;s operational record.</p>
          </article>
          <article className="cap">
            <div className="cap-icon" aria-hidden="true">✓</div>
            <h3>Proof of delivery</h3>
            <p>Delivery confirmation, recipient details, signatures, photos, location and POD records can remain attached to the completed movement.</p>
          </article>
          <article className="cap">
            <div className="cap-icon" aria-hidden="true">⛓</div>
            <h3>Custody chain</h3>
            <p>Custody events form an ordered, tamper-evident chain so transfer history can be reconstructed and verified afterwards.</p>
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
        title="Carry the container record all the way to closure"
        body="Bookings, trips, e-locks, field operations, alerts, documents, intelligence, analytics, billing and proof of delivery in one Container Delivery System."
      />
      <RelatedPages currentPath="/container-delivery" />
    </MarketingLayout>
  );
}
