import MarketingLayout from '../../components/marketing/MarketingLayout.js';
import {
  CtaBand,
  FeatureBlock,
  RelatedPages,
  SectionHeading,
} from '../../components/marketing/ui.js';
import { ContainerVisual, OpsMapVisual } from '../../components/marketing/visuals.js';
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
          Operations technology for{' '}
          <span className="grad">fleets, convoys and container logistics</span>
        </h1>
        <p className="hero-lead">
          Sonalit is built for organisations that move goods and have to answer for them — where the
          vehicle, the escort, the container and the customer are all part of the same job, and the
          tools for each are usually not.
        </p>
      </header>

      <section className="section section-tight" aria-label="Why Sonalit exists">
        <FeatureBlock
          title="Logistics operations are one problem, not four tools"
          body="Most operations run a tracking product, a spreadsheet for containers, a messaging group for the field and a reporting pack assembled by hand at month end. None of them agree, and the reconciliation work becomes the job."
          points={[
            'One operational record behind every surface',
            'The fleet vehicle is the convoy vehicle is the container vehicle',
            'Alerts, field reports and deliveries land in the same system',
            'Reporting is a by-product of running the operation',
          ]}
          visual={<OpsMapVisual />}
          visualLabel="One Operational Record"
        />
      </section>

      <section className="section" aria-labelledby="who-heading">
        <SectionHeading
          id="who-heading"
          label="Who it is for"
          title="Built for the people actually running the operation"
          desc="Each role gets a surface designed for the work it does, rather than one dashboard everybody has to tolerate."
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
          title="Multi-tenant, with isolation at the data layer"
          body="Sonalit is engineered as a multi-tenant system: organisations share the platform, never each other's data. Isolation is enforced in the database itself, and access inside an organisation is decided by role."
          points={[
            'Per-organisation isolation enforced at the database layer',
            'Role-based access control across every surface',
            'Separate authentication for operators, field crews and cargo owners',
            'Real-time delivery of telemetry and field activity to the browser',
          ]}
          visual={<ContainerVisual />}
          visualLabel="Platform Architecture"
        />
      </section>

      <CtaBand
        title="Talk to us about your operation"
        body="If you move vehicles, convoys or containers and want them in one system, we would like to hear how you run today."
      />
      <RelatedPages currentPath="/about" />
    </MarketingLayout>
  );
}
