import MarketingLayout from '../../components/marketing/MarketingLayout.js';
import { Eyebrow, RelatedPages, Section, SectionHeading } from '../../components/marketing/ui.js';
import { getPageSeo } from '../../lib/seo/pages.js';

const PAGE = getPageSeo('/contact');

/**
 * Contact routes are deliberately the ones that actually exist today: the
 * operations mailbox the product already directs access requests to, and the
 * "Request access" form on the sign-in screen. No contact form is rendered
 * here — there is no public contact endpoint behind it, and a form that
 * silently fails is worse than an address that works.
 */
const CONTACT_EMAIL = 'ops@sonalit.io';

export default function Contact(): React.ReactElement {
  return (
    <MarketingLayout page={PAGE}>
      <section aria-labelledby="contact-hero" className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_55%_at_15%_0%,rgba(255,122,0,0.10),transparent_70%)]"
        />
        <div className="relative mx-auto max-w-7xl px-5 pb-16 pt-16 lg:px-8 lg:pb-24 lg:pt-24">
          <Eyebrow>Contact</Eyebrow>
          <h1
            id="contact-hero"
            className="max-w-3xl text-[34px] font-bold leading-[1.1] tracking-[-0.03em] text-d-t1 sm:text-[46px]"
          >
            Contact Sonalit
          </h1>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-d-t2">
            Whether you are evaluating Sonalit for a fleet, a convoy operation or container
            delivery, or you already use the platform and need help, these are the ways to reach
            the team.
          </p>
        </div>
      </section>

      <Section labelledBy="reach-heading" tone="carbon">
        <SectionHeading
          id="reach-heading"
          eyebrow="How to reach us"
          title="Two routes, depending on what you need"
        />
        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl border border-d-rim bg-d-deep/70 p-7">
            <h3 className="text-[17px] font-semibold text-d-t1">Email the operations team</h3>
            <p className="mt-3 text-[14.5px] leading-relaxed text-d-t2">
              For platform enquiries, access requests, support and anything about running Sonalit in
              your organisation.
            </p>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="mt-6 inline-block rounded-md bg-cds-orange px-5 py-3 text-[14.5px] font-semibold text-[#170900] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cds-orange"
            >
              Email {CONTACT_EMAIL}
            </a>
          </div>

          <div className="rounded-xl border border-d-rim bg-d-deep/70 p-7">
            <h3 className="text-[17px] font-semibold text-d-t1">Request access to the platform</h3>
            <p className="mt-3 text-[14.5px] leading-relaxed text-d-t2">
              Sonalit accounts are issued per organisation. The sign-in screen carries a request
              access form for teams that do not have credentials yet.
            </p>
            <a
              href="/login"
              className="mt-6 inline-block rounded-md border border-d-rim2 px-5 py-3 text-[14.5px] font-semibold text-d-t1 transition-colors hover:border-cds-orange hover:text-cds-orange focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cds-orange"
            >
              Go to the Sonalit sign-in screen
            </a>
          </div>
        </div>
      </Section>

      <Section labelledBy="helpful-heading">
        <SectionHeading
          id="helpful-heading"
          eyebrow="Before you write"
          title="What helps us answer quickly"
          lede="A short description of how you operate today tells us more than a feature list ever could."
        />
        <ul className="mt-8 grid max-w-4xl gap-3 sm:grid-cols-2">
          {[
            'Roughly how many vehicles, convoys or containers you move',
            'Which of fleet, convoy, container delivery or security operations matters most',
            'Where you operate and which corridors or ports are involved',
            'What you use today, and the part of it that is not working',
            'Who would use the platform: control room, field crews, clients, or all three',
            'Whether you need mobile applications for field or yard teams',
          ].map((item) => (
            <li key={item} className="flex gap-3 text-[14.5px] leading-relaxed text-d-t2">
              <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-cds-orange" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-[15px] leading-relaxed text-d-t2">
          Not sure which part of the platform fits? Start with{' '}
          <a href="/fleet-management" className="font-semibold text-cds-orange hover:underline">
            fleet management
          </a>
          ,{' '}
          <a href="/convoy-management" className="font-semibold text-cds-orange hover:underline">
            convoy management
          </a>{' '}
          or{' '}
          <a href="/container-delivery" className="font-semibold text-cds-orange hover:underline">
            container delivery
          </a>
          .
        </p>
      </Section>

      <RelatedPages currentPath="/contact" />
    </MarketingLayout>
  );
}
