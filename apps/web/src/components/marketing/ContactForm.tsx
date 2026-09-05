import { useId, useState } from 'react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Status = 'idle' | 'sending' | 'sent' | 'error';

/**
 * Enquiry form on the public /contact page.
 *
 * Posts to the same endpoint as the "Request access" dialog on /login
 * (POST /api/v1/auth/request-access), tagged source: 'contact'. That route is
 * pre-auth and CSRF-exempt, because these pages are prerendered static HTML
 * and never call the API before submit — the visitor has no CSRF cookie to
 * send.
 *
 * The API client is imported dynamically, on submit, for two reasons: it pulls
 * axios, the auth store and OpenTelemetry, none of which a marketing page
 * should download to render; and scripts/prerender.tsx imports this component
 * outside Vite, where a module-scope import of that graph would throw.
 */
export default function ContactForm({ contactEmail }: { contactEmail: string }): React.ReactElement {
  const id = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [organization, setOrganization] = useState('');
  const [message, setMessage] = useState('');
  const [emailError, setEmailError] = useState(false);
  const [status, setStatus] = useState<Status>('idle');

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setEmailError(true);
      return;
    }
    setEmailError(false);
    setStatus('sending');
    try {
      const { submitAccessRequest } = await import('../../features/auth/login/authApi.js');
      await submitAccessRequest({
        email: trimmed,
        name: name.trim(),
        organization: organization.trim(),
        message: message.trim(),
        source: 'contact',
      });
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  }

  if (status === 'sent') {
    return (
      <div className="form-status form-status-ok" role="status">
        Thank you — your enquiry has been recorded and sent to the Sonalit operations team. We will
        reply to <strong>{email.trim()}</strong>.
      </div>
    );
  }

  return (
    <form onSubmit={(event) => { void onSubmit(event); }} noValidate>
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`${id}-name`}>
            Your name <span className="optional">(optional)</span>
          </label>
          <input
            id={`${id}-name`}
            name="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => { setName(e.target.value); }}
            placeholder="Jane Okafor"
          />
        </div>

        <div className="field">
          <label htmlFor={`${id}-email`}>Work email</label>
          <input
            id={`${id}-email`}
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(false); }}
            aria-invalid={emailError || undefined}
            aria-describedby={emailError ? `${id}-email-error` : undefined}
            placeholder="you@company.com"
          />
          {emailError ? (
            <span className="field-error" id={`${id}-email-error`}>
              Enter a valid email address so we can reply.
            </span>
          ) : null}
        </div>

        <div className="field field-wide">
          <label htmlFor={`${id}-org`}>
            Organisation <span className="optional">(optional)</span>
          </label>
          <input
            id={`${id}-org`}
            name="organization"
            type="text"
            autoComplete="organization"
            value={organization}
            onChange={(e) => { setOrganization(e.target.value); }}
            placeholder="Company or operation name"
          />
        </div>

        <div className="field field-wide">
          <label htmlFor={`${id}-message`}>
            How do you operate today? <span className="optional">(optional)</span>
          </label>
          <textarea
            id={`${id}-message`}
            name="message"
            value={message}
            onChange={(e) => { setMessage(e.target.value); }}
            placeholder="Fleet size, corridors or ports you run, and what is not working with your current tools."
          />
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary btn-lg" disabled={status === 'sending'}>
          {status === 'sending' ? 'Sending…' : 'Send enquiry'}
        </button>
        <span className="form-note">We reply to the address you give us. Nothing else is stored.</span>
      </div>

      {status === 'error' ? (
        <div className="form-status form-status-error" role="alert">
          That did not go through. Please try again, or email us directly at{' '}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
        </div>
      ) : null}
    </form>
  );
}
