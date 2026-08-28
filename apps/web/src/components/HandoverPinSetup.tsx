import { useState, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Lock, ArrowRight, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api.js';

interface Props {
  onComplete: () => void;
}

export default function HandoverPinSetup({ onComplete }: Props) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, [step]);

  const setMut = useMutation({
    mutationFn: async (pinVal: string) => {
      await api.post('/handover-auth/pin/set', { pin: pinVal });
    },
    onSuccess: () => {
      onComplete();
    },
    onError: (err: any) => {
      setError(err?.response?.data?.error ?? 'Failed to set PIN');
    },
  });

  function onPinInput(val: string, setter: (v: string) => void) {
    const clean = val.replace(/\D/g, '').slice(0, 8);
    setter(clean);
    setError(null);
  }

  function onNext() {
    if (pin.length < 4) {
      setError('PIN must be at least 4 digits');
      return;
    }
    setStep('confirm');
    setConfirm('');
  }

  function onConfirm() {
    if (confirm !== pin) {
      setError('PINs do not match');
      setConfirm('');
      return;
    }
    setMut.mutate(pin);
  }

  return (
    <>
      <div className="ho-pin-setup">
        <div className="ho-pin-setup-icon">
          <Lock size={24} />
        </div>
        <h2 className="ho-pin-setup-title">Set your PIN</h2>
        <p className="ho-pin-setup-sub">
          {step === 'enter'
            ? 'Create a 4-8 digit PIN for quick sign-in.'
            : 'Enter your PIN again to confirm.'}
        </p>

        <div className="ho-pin-dots">
          {Array.from({ length: step === 'enter' ? pin.length : confirm.length }).map((_, i) => (
            <span key={i} className="ho-pin-dot ho-pin-dot-filled" />
          ))}
          {Array.from({ length: Math.max(0, 4 - (step === 'enter' ? pin.length : confirm.length)) }).map((_, i) => (
            <span key={`e-${i}`} className="ho-pin-dot" />
          ))}
        </div>

        <input
          ref={inputRef}
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={step === 'enter' ? pin : confirm}
          onChange={(e) => onPinInput(e.target.value, step === 'enter' ? setPin : setConfirm)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              step === 'enter' ? onNext() : onConfirm();
            }
          }}
          className="ho-pin-hidden-input"
          aria-label={step === 'enter' ? 'Enter new PIN' : 'Confirm PIN'}
        />

        {error && (
          <div className="ho-pin-error">
            <AlertCircle size={13} /> {error}
          </div>
        )}

        <button
          className="ho-pin-cta"
          disabled={
            setMut.isPending ||
            (step === 'enter' ? pin.length < 4 : confirm.length < 4)
          }
          onClick={() => step === 'enter' ? onNext() : onConfirm()}
        >
          {setMut.isPending ? (
            <Loader2 size={16} className="ho-spin" />
          ) : step === 'enter' ? (
            <>Next <ArrowRight size={14} /></>
          ) : (
            <>Confirm <CheckCircle2 size={14} /></>
          )}
        </button>

        {step === 'confirm' && (
          <button className="ho-pin-back" onClick={() => { setStep('enter'); setConfirm(''); setError(null); }}>
            Back
          </button>
        )}
      </div>

      <style>{`
        .ho-pin-setup {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          padding: 48px 24px;
          max-width: 360px;
          margin: 0 auto;
        }
        .ho-pin-setup-icon {
          width: 56px; height: 56px;
          border-radius: 14px;
          background: linear-gradient(135deg, rgba(34,232,255,.12), rgba(139,107,255,.12));
          border: 1px solid rgba(34,232,255,.18);
          display: flex; align-items: center; justify-content: center;
          color: var(--d-sig);
          margin-bottom: 20px;
        }
        .ho-pin-setup-title {
          font-family: var(--d-font);
          font-size: 20px;
          font-weight: 700;
          color: var(--d-t1);
          margin: 0 0 8px;
        }
        .ho-pin-setup-sub {
          font-size: 13px;
          color: var(--d-t2);
          margin: 0 0 28px;
          line-height: 1.5;
        }
        .ho-pin-dots {
          display: flex;
          gap: 12px;
          margin-bottom: 20px;
        }
        .ho-pin-dot {
          width: 14px; height: 14px;
          border-radius: 50%;
          border: 2px solid var(--d-rim3);
          transition: all .15s;
        }
        .ho-pin-dot-filled {
          background: var(--d-sig);
          border-color: var(--d-sig);
        }
        .ho-pin-hidden-input {
          position: absolute;
          opacity: 0;
          pointer-events: none;
          width: 1px; height: 1px;
        }
        .ho-pin-error {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 12px;
          color: var(--d-fire);
          margin-bottom: 16px;
        }
        .ho-pin-cta {
          width: 100%;
          max-width: 240px;
          padding: 12px;
          border: none;
          border-radius: 8px;
          background: var(--d-sig);
          color: var(--d-void);
          font-family: var(--d-font);
          font-size: 14px;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          cursor: pointer;
          transition: filter .15s;
        }
        .ho-pin-cta:hover:not(:disabled) { filter: brightness(1.1); }
        .ho-pin-cta:disabled { opacity: .5; cursor: default; }
        .ho-pin-back {
          margin-top: 12px;
          background: none;
          border: none;
          color: var(--d-t2);
          font-family: var(--d-font-mono);
          font-size: 12px;
          cursor: pointer;
          padding: 4px 8px;
        }
        .ho-pin-back:hover { color: var(--d-t1); }
      `}</style>
    </>
  );
}
