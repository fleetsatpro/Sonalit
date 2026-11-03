import { useEffect, useState } from 'react';
import { useModal } from './useModal';
import { requestPasswordReset } from './authApi';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Props = { open: boolean; onClose: () => void; initialEmail?: string };

export default function ForgotPasswordModal({ open, onClose, initialEmail = '' }: Props): React.ReactElement {
  const rootRef = useModal(open, onClose);
  const [email, setEmail] = useState<string>(initialEmail);
  const [emailError, setEmailError] = useState<boolean>(false);
  const [success, setSuccess] = useState<boolean>(false);
  const [failure, setFailure] = useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);

  useEffect(() => {
    if (open) {
      setEmail(initialEmail);
      setEmailError(false); setSuccess(false); setFailure(false); setSending(false);
    }
  }, [open, initialEmail]);

  async function submit(): Promise<void> {
    setSuccess(false); setFailure(false);
    const v = email.trim();
    if (!EMAIL_RE.test(v)) { setEmailError(true); return; }
    setEmailError(false);
    setSending(true);
    try {
      await requestPasswordReset(v);
      setSuccess(true);
    } catch {
      setFailure(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className={'modal-backdrop' + (open ? ' open' : '')}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="forgotTitle">
        <div className="modal-head">
          <div className="modal-title" id="forgotTitle">Reset password</div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close dialog">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <p>Enter the email on your Sonalit account and we&apos;ll send a link to reset your password.</p>
          <label className="sr-only" htmlFor="resetEmailInput">Email address</label>
          <div className={'field-input-row' + (emailError ? ' error' : '')}>
            <input
              type="email" id="resetEmailInput"
              placeholder="you@company.com" autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className={'field-msg err' + (emailError ? ' show' : '')} role="alert">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16v.01" strokeLinecap="round" />
            </svg>
            <span>Enter a valid email address</span>
          </div>
          <div className={'modal-success' + (success ? ' show' : '')} role="status">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="12" r="9" />
            </svg>
            <span>If that email is registered, a reset link is on its way.</span>
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
          <button type="button" className="btn btn-primary" disabled={sending} onClick={() => void submit()}>
            {sending ? 'SENDING…' : 'SEND RESET LINK'}
          </button>
        </div>
      </div>
    </div>
  );
}
