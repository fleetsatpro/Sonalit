import ContactForm from '../../components/marketing/ContactForm.js';
import MarketingLayout from '../../components/marketing/MarketingLayout.js';
import { RelatedPages, SectionHeading } from '../../components/marketing/ui.js';
import { getPageSeo } from '../../lib/seo/pages.js';

const PAGE = getPageSeo('/contact');

/**
 * The enquiry form posts to POST /api/v1/auth/request-access, which records the
 * request before attempting to notify — so a submission is never lost to a mail
 * outage. The mailbox below is the fallback for anyone who would rather use
 * their own mail client; the backend's recipient is set by ACCESS_REQUEST_TO
 * and defaults to the same address.
 */
const CONTACT_EMAIL = 'ops@sonalit.com';

const HELPFUL = [
  'Roughly how many vehicles, convoys or containers you move',
  'Which of fleet, convoy, container delivery or security matters most',
  'Where you operate, and which corridors or ports are involved',
  'What you use today, and the part of it that is not working',
  'Who would use the platform: control room, field crews, clients',
  'Whether you need mobile applications for field or yard teams',
];

export default function Contact(): React.ReactElement {
  return (
    <MarketingLayout page={PAGE}>
      <header className="hero hero-compact">
        <div className="hero-badge">
          <i aria-hidden="true" /> Contact
        </div>
        <h1>
          Contact <span className="grad">Sonalit</span>
        </h1>
        <p className="hero-lead">
          Whether you are evaluating Sonalit for a fleet, a convoy operation or container delivery,
          or you already use the platform and need help, these are the ways to reach the team.
        </p>
      </header>

      <section className="section section-tight" aria-labelledby="reach-heading">
        <SectionHeading
          id="reach-heading"
          label="How to reach us"
          title="Tell us about your operation"
          desc="Send this straight to the Sonalit operations team. If you would rather use your own mail client, the address below works just as well."
        />
        <ContactForm contactEmail={CONTACT_EMAIL} />

        <div className="cap-grid cap-grid-2 grid-after">
          <article className="cap">
            <div className="cap-icon" aria-hidden="true">✉</div>
            <h3>Email the operations team</h3>
            <p>
              For platform enquiries, access requests, support and anything about running Sonalit in
              your organisation.
            </p>
            <a className="btn btn-ghost" href={`mailto:${CONTACT_EMAIL}`}>
              Email {CONTACT_EMAIL}
            </a>
          </article>

          <article className="cap">
            <div className="cap-icon" aria-hidden="true">⌗</div>
            <h3>Already have an account?</h3>
            <p>
              Sonalit accounts are issued per organisation. Sign in to the operations platform, or
              use the request access form on the sign-in screen.
            </p>
            <a className="btn btn-ghost" href="/login">
              Go to the Sonalit sign-in screen
            </a>
          </article>
        </div>
      </section>

      <section className="section" aria-labelledby="helpful-heading">
        <SectionHeading
          id="helpful-heading"
          label="Before you write"
          title="What helps us answer quickly"
          desc="A short description of how you operate today tells us more than a feature list ever could."
        />
        <ul className="feat-list check-grid">
          {HELPFUL.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <RelatedPages currentPath="/contact" />
    </MarketingLayout>
  );
}
