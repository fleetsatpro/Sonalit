import MarketingLayout from '../../components/marketing/MarketingLayout.js';
import {
  CtaBand,
  FeatureBlock,
  RelatedPages,
  SectionHeading,
} from '../../components/marketing/ui.js';
import { ContainerVisual, OpsVisual } from '../../components/marketing/visuals.js';
import { getPageSeo } from '../../lib/seo/pages.js';

const PAGE = getPageSeo('/about');

const AUDIENCES = [
  { icon: '◈', title: 'Control room operators', body: 'A live operations view with the map, the alert queue and the incident record in one place.' },
  { icon: '⬡', title: 'Convoy field officers', body: 'A mobile companion for running a convoy from the road: checks, photos, status and escalation.' },
  { icon: '▣', title: 'Yard and port crews', body: 'Device-paired field applications for container movements, e-lock operations and handovers.' },
  { icon: '◇', title: 'Fleet and logistics managers', body: 'Maintenance, fuel, shifts, utilisation and reporting over the same live operational data.' },
  { icon: '◎', title: 'Security and response teams', body: 'Alerting, panic escalation, geofencing and incident handling with the operational context attached.' },
  { icon: '⚿', title: 'Cargo owners', body: 'A scoped client portal covering only their own shipments: tracking, manifest and delivery record.' },
];

export default function About(): React.ReactElement {
  return (
    <MarketingLayout page={PAGE}>
      <header className="hero hero-compact">
        <div className="hero-badge">
          <i aria-hidden="true" /> About Sonalit
        </div>
        <h1>
          An operational system for what happens
          between movement and consequence.
        </h1>
        <p className="hero-lead">
          Sonalit is built for operations in which vehicles, cargo, field teams, devices and security responsibilities change state throughout the day. Its purpose is to preserve the thread between movement, context, intervention and proof — where fragmented systems usually leave the work to spreadsheets, calls and memory.
        </p>
      </header>

      <section className="section section-tight" aria-label="Why Sonalit exists">
        <FeatureBlock
          title="The operation is continuous. The software should be."
          body="A live map cannot tell you who owns the handoff. A container register cannot explain the route deviation. A message thread cannot establish the chronology. Sonalit connects those states so operators can work on the movement itself rather than reconcile disconnected artefacts."
          points={[
            'One canonical operational state behind every surface',
            'The vehicle, convoy and container retain their identity across the workflow',
            'Alerts, incidents, field evidence and delivery events remain connected',
            'Replay, reports and audit trails inherit the evidence already recorded',
          ]}
          visual={<OpsVisual />}
          visualLabel="One Operational Record"
        />
      </section>

      <section className="section" aria-labelledby="who-heading">
        <SectionHeading
          id="who-heading"
          label="Who it is for"
          title="Purpose-built surfaces for the people making the decisions"
          desc="Different roles need different interfaces, not different truths. Sonalit separates the surface while preserving the operational state beneath it."
        />
        <div className="cap-grid cap-grid-3">
          {AUDIENCES.map((a) => (
            <article className="cap" key={a.title}>
              <div className="cap-icon" aria-hidden="true">{a.icon}</div>
              <h3>{a.title}</h3>
              <p>{a.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section section-tight" aria-label="How Sonalit is built">
        <FeatureBlock
          flip
          title="A platform architecture designed for governed operational data"
          body="Sonalit is multi-tenant by design, with organisation-scoped data isolation, role-aware access and separate authentication boundaries for operators, field crews and cargo owners. Realtime activity, audit trails and evidence remain tied to the organisation and workflow that produced them."
          points={[
            'Per-organisation isolation enforced at the data layer',
            'Role-based access across operational surfaces',
            'Separate operator, field, Guardian and cargo-owner access domains',
            'Realtime delivery of telemetry, events and field activity',
          ]}
          visual={<ContainerVisual />}
          visualLabel="Platform Architecture"
        />
      </section>

      <CtaBand
        title="Design the operating picture around your actual workflow"
        body="Tell us where movement, custody, security or evidence breaks down today. We can then show where Sonalit’s operational fabric fits."
      />
      <RelatedPages currentPath="/about" />
    </MarketingLayout>
  );
}
