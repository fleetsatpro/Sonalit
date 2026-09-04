import MarketingLayout from '../../components/marketing/MarketingLayout.js';
import {
  CtaBand,
  FeatureBlock,
  RelatedPages,
  SectionHeading,
} from '../../components/marketing/ui.js';
import { ConvoyVisual, SecurityVisual } from '../../components/marketing/visuals.js';
import { getPageSeo } from '../../lib/seo/pages.js';

const PAGE = getPageSeo('/security-operations');

export default function SecurityOperations(): React.ReactElement {
  return (
    <MarketingLayout page={PAGE}>
      <header className="hero hero-compact">
        <div className="hero-badge">
          <i aria-hidden="true" /> Security Operations
        </div>
        <h1>
          Fleet and security operations in{' '}
          <span className="grad">one control room</span>
        </h1>
        <p className="hero-lead">
          Monitoring is only useful if something happens when a condition is met. Sonalit turns
          positions, geofences, device signals and field reports into alerts an operator can act on,
          and keeps the response attached to the event that triggered it.
        </p>
      </header>

      <section className="section section-tight" aria-label="Security operations capabilities">
        <FeatureBlock
          title="From signal to response, with the trail intact"
          body="An alert, an incident and the response to it stay connected. What was raised, who acknowledged it, what was done and how it resolved are one record — which is also what makes an after-action review possible."
          points={[
            'A single prioritised alert and incident queue',
            'Panic escalation carrying its location and context',
            'Response crews reporting into the same incident',
            'Incident history retained with its full context',
          ]}
          visual={<SecurityVisual />}
          visualLabel="Alert &amp; Response"
        />

        <FeatureBlock
          flip
          title="Geography as an operational control"
          body="Depots, checkpoints, customer sites and restricted ground are drawn once and then enforced continuously — entry, exit and corridor departure all become events with a time and an owner."
          points={[
            'Geofence definition and management per organisation',
            'Corridor evaluation against a planned route',
            'Route risk analysis used at planning time',
            'Risk intelligence gathered from open sources',
          ]}
          visual={<ConvoyVisual />}
          visualLabel="Geofence &amp; Corridor"
        />
      </section>

      <section className="section" aria-labelledby="awareness-heading">
        <SectionHeading
          id="awareness-heading"
          label="Situational awareness"
          title="Everyone looking at the same picture"
          desc="Control room operators, convoy field officers, yard crews and response teams each work in the surface built for their role, but all of them read and write the same underlying operational record."
        />
        <div className="cap-grid cap-grid-3">
          <article className="cap">
            <div className="cap-icon" aria-hidden="true">≋</div>
            <h3>Live operational feed</h3>
            <p>Alerts, incidents and field activity arrive in one chronological stream, pushed to the browser as they happen.</p>
          </article>
          <article className="cap">
            <div className="cap-icon" aria-hidden="true">⚑</div>
            <h3>Rule engine</h3>
            <p>Conditions that matter to your operation are expressed as rules, and matching events raise alerts automatically.</p>
          </article>
          <article className="cap">
            <div className="cap-icon" aria-hidden="true">◍</div>
            <h3>Signal health</h3>
            <p>Devices that stop reporting are surfaced as a problem in their own right, rather than being silently absent from the map.</p>
          </article>
        </div>
        <p className="prose prose-after">
          Security operations sit on the same data as{' '}
          <a className="inline-link" href="/fleet-management">fleet management</a>,{' '}
          <a className="inline-link" href="/convoy-management">convoy management</a> and{' '}
          <a className="inline-link" href="/container-delivery">container delivery</a>.
        </p>
      </section>

      <CtaBand
        title="Give your control room something to act on"
        body="Sonalit turns tracking data and field reports into alerts, incidents and a response record."
      />
      <RelatedPages currentPath="/security-operations" />
    </MarketingLayout>
  );
}
