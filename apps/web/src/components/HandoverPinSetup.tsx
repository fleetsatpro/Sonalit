import { useState, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Lock, ArrowRight, Loader2, AlertCircle, CheckCircle2, ChevronLeft } from 'lucide-react';
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

  const currentVal = step === 'enter' ? pin : confirm;
  const maxDots = Math.max(4, currentVal.length);

  return (
    <>
      <div className="ho-pin-setup">
        <div className="ho-pin-icon">
          <Lock size={22} />
        </div>

        <h2 className="ho-pin-title">
          {step === 'enter' ? 'Set your PIN' : 'Confirm your PIN'}
        </h2>

        <p className="ho-pin-sub">
          {step === 'enter'
            ? 'Create a 4–8 digit PIN for quick sign-in.'
            : 'Enter your PIN again to confirm.'}
        </p>

        <div className="ho-pin-dots" onClick={() => inputRef.current?.focus()} role="presentation">
          {Array.from({ length: maxDots }).map((_, i) => (
            <span
              key={i}
              className={`ho-pin-dot ${i < currentVal.length ? 'ho-pin-dot-filled' : ''}`}
            />
          ))}
        </div>

        <input
          ref={inputRef}
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={currentVal}
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
            <AlertCircle size={12} /> {error}
          </div>
        )}

        <button
          className="ho-pin-cta"
          disabled={setMut.isPending || currentVal.length < 4}
          onClick={() => step === 'enter' ? onNext() : onConfirm()}
        >
          {setMut.isPending ? (
            <Loader2 size={15} className="ho-pin-spin" />
          ) : step === 'enter' ? (
            <>Next <ArrowRight size={14} /></>
          ) : (
            <>Confirm <CheckCircle2 size={14} /></>
          )}
        </button>

        {step === 'confirm' && (
          <button
            className="ho-pin-back"
            onClick={() => { setStep('enter'); setConfirm(''); setError(null); }}
          >
            <ChevronLeft size={13} /> Back
          </button>
        )}

        <div className="ho-pin-hint">Tap dots to type</div>
      </div>

      <style>{`
        .ho-pin-setup {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          padding: 48px 24px 32px;
          max-width: 360px;
          margin: 0 auto;
          animation: ho-pin-rise .4s ease both;
        }

        .ho-pin-icon {
          width: 52px;
          height: 52px;
          border-radius: 14px;
          background: linear-gradient(145deg, rgba(139,107,255,.14), rgba(34,232,255,.14));
          box-shadow: 0 0 0 1px rgba(34,232,255,.12);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--d-sig);
          margin-bottom: 20px;
        }

        .ho-pin-title {
          font-family: var(--d-font);
          font-size: 20px;
          font-weight: 600;
          color: var(--d-t1);
          margin: 0 0 8px;
          line-height: 1.2;
          letter-spacing: -.01em;
        }

        .ho-pin-sub {
          font-size: 13px;
          color: var(--d-t2);
          margin: 0 0 32px;
          line-height: 1.5;
        }

        .ho-pin-dots {
          display: flex;
          gap: 12px;
          margin-bottom: 24px;
          cursor: text;
          padding: 8px 4px;
        }

        .ho-pin-dot {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          box-shadow: inset 0 0 0 2px rgba(200,215,240,.15);
          transition: all .15s ease;
          background: transparent;
        }

        .ho-pin-dot-filled {
          background: var(--d-sig);
          box-shadow: inset 0 0 0 2px var(--d-sig);
          transform: scale(1.1);
        }

        .ho-pin-hidden-input {
          position: absolute;
          opacity: 0;
          pointer-events: none;
          width: 1px;
          height: 1px;
        }

        .ho-pin-error {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 12px;
          color: var(--d-fire);
          margin-bottom: 16px;
          padding: 6px 12px;
          border-radius: 8px;
          background: rgba(255,59,92,.06);
          box-shadow: 0 0 0 1px rgba(255,59,92,.15);
        }

        .ho-pin-cta {
          width: 100%;
          max-width: 220px;
          padding: 12px;
          border: none;
          border-radius: 10px;
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
          transition: all .15s;
        }
        .ho-pin-cta:hover:not(:disabled) { filter: brightness(1.1); }
        .ho-pin-cta:active:not(:disabled) { transform: scale(.98); }
        .ho-pin-cta:disabled { opacity: .45; cursor: default; }

        .ho-pin-back {
          margin-top: 14px;
          display: inline-flex;
          align-items: center;
          gap: 2px;
          background: none;
          border: none;
          color: var(--d-t2);
          font-family: var(--d-font);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 6px;
          transition: color .15s;
        }
        .ho-pin-back:hover { color: var(--d-t1); }

        .ho-pin-hint {
          margin-top: 28px;
          font-family: var(--d-font-mono);
          font-size: 10px;
          color: var(--d-t3);
          letter-spacing: .04em;
        }

        .ho-pin-spin {
          animation: ho-pin-spin-anim .7s linear infinite;
        }

        @keyframes ho-pin-spin-anim {
          to { transform: rotate(360deg); }
        }

        @keyframes ho-pin-rise {
          from {
            opacity: 0;
            transform: translateY(10px);
            filter: blur(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
            filter: blur(0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .ho-pin-spin { animation: none; }
          .ho-pin-setup { animation: none; }
          .ho-pin-dot-filled { transform: none; }
        }
      `}</style>
    </>
  );
}
