import { useEffect, useState } from 'react';
import { useModal } from './useModal';
import { requestAccess } from './authApi';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RequestAccessModal({ open, onClose }) {
  const rootRef = useModal(open, onClose);
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState('');
  const [emailError, setEmailError] = useState(false);
  const [orgError, setOrgError] = useState(false);
  const [success, setSuccess] = useState(false);
  const [failure, setFailure] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail(''); setOrg('');
      setEmailError(false); setOrgError(false);
      setSuccess(false); setFailure(false);
      setSending(false);
    }
  }, [open]);

  async function submit() {
    setSuccess(false); setFailure(false);
    const e = email.trim();
    const o = org.trim();
    let bad = false;
    if (!EMAIL_RE.test(e)) { setEmailError(true); bad = true; } else setEmailError(false);
    if (!o) { setOrgError(true); bad = true; } else setOrgError(false);
    if (bad) return;

    setSending(true);
    try {
      await requestAccess(e, o);
      setSuccess(true);
    } catch (_err) {
      setFailure(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className={'modal-backdrop' + (open ? ' open' : '')}
      onMouseDown={(evt) => { if (evt.target === evt.currentTarget) onClose(); }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="requestTitle">
        <div className="modal-head">
          <div className="modal-title" id="requestTitle">Request access</div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close dialog">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <p>Tell us about your fleet and a Sonalit team member will reach out to set up your organization.</p>

          <label className="field-label" htmlFor="requestEmailInput" style={{ display: 'block', marginBottom: 6 }}>
            WORK EMAIL
          </label>
          <div className={'field-input-row' + (emailError ? ' error' : '')} style={{ marginBottom: 6 }}>
            <input
              type="email" id="requestEmailInput"
              placeholder="you@company.com" autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className={'field-msg err' + (emailError ? ' show' : '')} role="alert" style={{ marginBottom: 10 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16v.01" strokeLinecap="round" />
            </svg>
            <span>Enter a valid work email address</span>
          </div>

          <label className="field-label" htmlFor="requestOrgInput" style={{ display: 'block', marginBottom: 6 }}>
            ORGANIZATION
          </label>
          <div className={'field-input-row' + (orgError ? ' error' : '')}>
            <input
              type="text" id="requestOrgInput"
              placeholder="Fleet operator name" autoComplete="organization"
              value={org} onChange={(e) => setOrg(e.target.value)}
            />
          </div>
          <div className={'field-msg err' + (orgError ? ' show' : '')} role="alert">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16v.01" strokeLinecap="round" />
            </svg>
            <span>Enter your organization name</span>
          </div>

          <div className={'modal-success' + (success ? ' show' : '')} role="status">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="12" r="9" />
            </svg>
            <span>Request submitted — we&apos;ll be in touch within one business day.</span>
          </div>
          <div className={'modal-error' + (failure ? ' show' : '')} role="alert">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16v.01" strokeLinecap="round" />
            </svg>
            <span>Something went wrong. Please try again.</span>
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>CANCEL</button>
          <button type="button" className="btn btn-primary" disabled={sending} onClick={submit}>
            {sending ? 'SUBMITTING…' : 'SUBMIT REQUEST'}
          </button>
        </div>
      </div>
    </div>
  );
}
