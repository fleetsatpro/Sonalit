/**
 * The Field app's sign-in surface: pair the tablet, then unlock it with a PIN.
 *
 * Designed for the actual conditions — one gloved hand, bright sun, a truck
 * idling behind you. Hence 64px targets, no keyboard except for the one-time
 * pairing code, and no email field anywhere: on a shared device, typing an
 * address at every handover is the thing crews stop doing.
 */
import { Delete, KeyRound, Loader2, RefreshCw, ShieldCheck, Truck, Anchor } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { changeOwnPin, fetchRoster, fieldError, useFieldAuth } from './fieldAuth.js';

import type { RosterEntry } from './fieldAuth.js';

const ROLE_META = {
  yard_agent: { label: 'Yard', accent: '#ff7a00', icon: Truck },
  port_agent: { label: 'Port', accent: '#37e6ff', icon: Anchor },
} as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function Backdrop() {
  return (
    <>
      <div className="pointer-events-none absolute -top-28 -left-24 w-80 h-80 rounded-full opacity-[.16] blur-3xl"
        style={{ background: 'radial-gradient(closest-side, #ff7a00, transparent)' }} />
      <div className="pointer-events-none absolute -bottom-32 -right-20 w-96 h-96 rounded-full opacity-[.12] blur-3xl"
        style={{ background: 'radial-gradient(closest-side, #37e6ff, transparent)' }} />
    </>
  );
}

function Brand({ caption }: { caption: string }) {
  return (
    <div className="relative flex flex-col items-center gap-3 pt-14 pb-8">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #ff7a00, #F0B429)', boxShadow: '0 12px 40px -12px rgba(255,122,0,.8)' }}>
        <Truck size={26} strokeWidth={2.4} color="#170d00" />
      </div>
      <div className="text-center">
        <div className="text-[10px] font-mono uppercase tracking-[.25em] text-text-2">Sonalit CDS</div>
        <div className="text-[22px] font-bold leading-tight mt-1">Field Ops</div>
        <div className="text-[12px] text-text-2 mt-1.5 max-w-[17rem] mx-auto leading-snug">{caption}</div>
      </div>
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl px-3.5 py-2.5 text-[12px] leading-snug"
      style={{ background: 'rgba(255,92,92,.12)', border: '1px solid rgba(255,92,92,.35)', color: '#ffb4b4' }}>
      {children}
    </div>
  );
}

// ─── 1. Pairing ──────────────────────────────────────────────────────────────

/** Codes are issued as XXXX-XXXX; accept any casing/spacing and re-format live. */
function formatCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

export function PairScreen() {
  const pair = useFieldAuth(s => s.pair);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ready = code.replace(/-/g, '').length === 8;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setError('');
    void (async () => {
      try {
        await pair(code);
      } catch (err) {
        setError(fieldError(err, 'Could not pair this device.'));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="min-h-screen w-full bg-ink-0 text-text-0 relative overflow-hidden flex flex-col">
      <Backdrop />
      <Brand caption="This device isn't paired yet. Ask a supervisor for a pairing code from the CDS dashboard." />

      <form onSubmit={submit} className="relative flex-1 px-6 flex flex-col">
        <label htmlFor="pairingCode" className="text-[11px] font-mono uppercase tracking-widest text-text-2 mb-2">
          Pairing code
        </label>
        <input
          id="pairingCode"
          value={code}
          onChange={e => setCode(formatCode(e.target.value))}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="ABCD-EFGH"
          className="w-full h-16 rounded-2xl bg-white/[.04] border border-white/[.12] px-5 text-[26px] font-mono tracking-[.2em] text-center text-text-0 placeholder:text-white/15 outline-none focus:border-cds-orange/60 transition-colors"
        />
        <p className="text-[11px] text-text-2 mt-3 leading-snug">
          Pairing is one-time. After this the tablet stays enrolled and crews sign in with a PIN.
        </p>

        {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}

        <div className="mt-auto pb-8 pt-6">
          <button
            type="submit"
            disabled={!ready || busy}
            className="w-full h-16 rounded-2xl font-bold text-[16px] flex items-center justify-center gap-2 disabled:opacity-35 active:scale-[.985] transition-all"
            style={{ background: 'linear-gradient(135deg, #ff7a00, #F0B429)', color: '#170d00' }}
          >
            {busy ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
            {busy ? 'Pairing…' : 'Pair this device'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── 2. Worker picker + PIN ──────────────────────────────────────────────────

function PinPad({ value, onChange, onSubmit, disabled }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; disabled: boolean;
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
  const press = (k: string) => {
    if (disabled) return;
    if (k === 'back') onChange(value.slice(0, -1));
    else if (k === 'clear') onChange('');
    else if (value.length < 8) onChange(value + k);
  };

  return (
    <div className="grid grid-cols-3 gap-2.5">
      {keys.map(k => (
        <button
          key={k}
          type="button"
          onClick={() => press(k)}
          disabled={disabled}
          aria-label={k === 'back' ? 'Delete' : k === 'clear' ? 'Clear' : k}
          className="h-[62px] rounded-2xl bg-white/[.05] border border-white/[.09] text-[24px] font-mono text-text-0 flex items-center justify-center active:scale-95 active:bg-white/[.1] disabled:opacity-40 transition-all"
        >
          {k === 'back' ? <Delete size={20} /> : k === 'clear' ? <span className="text-[12px] font-sans font-bold tracking-wide">CLR</span> : k}
        </button>
      ))}
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled || value.length < 4}
        className="col-span-3 h-16 mt-1 rounded-2xl font-bold text-[16px] flex items-center justify-center gap-2 disabled:opacity-35 active:scale-[.985] transition-all"
        style={{ background: 'linear-gradient(135deg, #ff7a00, #F0B429)', color: '#170d00' }}
      >
        <KeyRound size={18} /> Sign in
      </button>
    </div>
  );
}

function PinDots({ length, error }: { length: number; error: boolean }) {
  return (
    <div className="flex items-center justify-center gap-3 h-8">
      {Array.from({ length: Math.max(4, length) }).map((_, i) => (
        <span
          key={i}
          className="w-3 h-3 rounded-full transition-all"
          style={{
            background: i < length ? (error ? '#ff5c5c' : '#ff7a00') : 'rgba(255,255,255,.14)',
            boxShadow: i < length && !error ? '0 0 12px -2px #ff7a00' : 'none',
          }}
        />
      ))}
    </div>
  );
}

export function LockScreen() {
  const device = useFieldAuth(s => s.device);
  const signIn = useFieldAuth(s => s.signIn);
  const unpair = useFieldAuth(s => s.unpair);

  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [rosterError, setRosterError] = useState('');
  const [picked, setPicked] = useState<RosterEntry | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useMemo(() => async () => {
    setRosterError('');
    try {
      setRoster(await fetchRoster());
    } catch (err) {
      setRosterError(fieldError(err, 'Could not load the crew list.'));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!picked || pin.length < 4 || busy) return;
    setBusy(true); setError('');
    try {
      await signIn(picked.id, pin);
    } catch (err) {
      setError(fieldError(err, 'Wrong PIN.'));
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const deviceChip = device
    ? [device.label, device.site].filter(Boolean).join(' · ')
    : 'Paired device';

  // ── PIN step ──
  if (picked) {
    const meta = ROLE_META[picked.role];
    return (
      <div className="min-h-screen w-full bg-ink-0 text-text-0 relative overflow-hidden flex flex-col">
        <Backdrop />
        {/* flex-1 + centre, not a fixed top block: the pad is anchored to the
            bottom for thumb reach, and on a tall tablet a top-aligned identity
            block leaves a dead band of nothing between the two. */}
        <div className="relative px-6 pt-10 pb-6 flex-1 flex flex-col items-center justify-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center text-[18px] font-bold"
            style={{ background: `${meta.accent}1f`, border: `1px solid ${meta.accent}55`, color: meta.accent }}>
            {initials(picked.name)}
          </div>
          <div className="text-[19px] font-bold mt-3">{picked.name}</div>
          <div className="text-[11px] font-mono uppercase tracking-widest text-text-2 mt-1">
            {meta.label} team · {deviceChip}
          </div>
          <div className="mt-6"><PinDots length={pin.length} error={Boolean(error)} /></div>
          {error && <div className="mt-4 w-full"><ErrorNote>{error}</ErrorNote></div>}
        </div>

        <div className="relative px-6 pb-7">
          <PinPad value={pin} onChange={setPin} onSubmit={() => { void submit(); }} disabled={busy} />
          <button
            type="button"
            onClick={() => { setPicked(null); setPin(''); setError(''); }}
            className="w-full mt-4 text-[12px] font-mono uppercase tracking-widest text-text-2 py-2 active:text-text-0"
          >
            Not you? Pick someone else
          </button>
        </div>
      </div>
    );
  }

  // ── Roster step ──
  return (
    <div className="min-h-screen w-full bg-ink-0 text-text-0 relative overflow-hidden flex flex-col">
      <Backdrop />
      <Brand caption={`Tap your name to start a shift on ${deviceChip}.`} />

      <div className="relative flex-1 px-5 pb-8">
        {rosterError && (
          <div className="space-y-3">
            <ErrorNote>{rosterError}</ErrorNote>
            <button onClick={() => { void load(); }}
              className="w-full h-12 rounded-xl bg-white/[.05] border border-white/10 text-[13px] font-bold flex items-center justify-center gap-2 active:scale-[.985]">
              <RefreshCw size={14} /> Try again
            </button>
          </div>
        )}

        {!roster && !rosterError && (
          <div className="flex items-center justify-center gap-2 py-14 text-text-2 text-[12px] font-mono">
            <Loader2 size={16} className="animate-spin" /> Loading crew…
          </div>
        )}

        {roster && roster.length === 0 && (
          <div className="rounded-2xl border border-white/[.08] bg-white/[.03] p-5 text-[12px] text-text-2 leading-relaxed">
            No field accounts are set up for this site yet. A supervisor creates them under
            CDS → Settings → Field accounts, then issues each person a PIN.
          </div>
        )}

        <div className="space-y-2.5">
          {(roster ?? []).map(w => {
            const meta = ROLE_META[w.role];
            const Icon = meta.icon;
            return (
              <button
                key={w.id}
                type="button"
                disabled={!w.has_pin}
                onClick={() => { setPicked(w); setPin(''); setError(''); }}
                className="w-full text-left rounded-2xl border border-white/[.08] bg-white/[.03] p-4 flex items-center gap-3.5 active:scale-[.985] disabled:opacity-40 transition-all"
              >
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-[14px] font-bold flex-shrink-0"
                  style={{ background: `${meta.accent}18`, border: `1px solid ${meta.accent}44`, color: meta.accent }}>
                  {initials(w.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-bold truncate">{w.name}</div>
                  <div className="text-[11px] font-mono uppercase tracking-wide text-text-2 mt-0.5 flex items-center gap-1.5">
                    <Icon size={11} /> {meta.label} team
                    {!w.has_pin && <span className="text-cds-amber">· no PIN yet</span>}
                    {w.locked && <span className="text-cds-red">· locked</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <footer className="relative px-6 pb-7 text-center">
        <button onClick={unpair}
          className="text-[11px] font-mono uppercase tracking-widest text-text-2/70 py-2 active:text-text-0">
          Unpair this device
        </button>
      </footer>
    </div>
  );
}

// ─── 3. Forced PIN change ────────────────────────────────────────────────────

/**
 * Shown once, right after a worker first signs in with the PIN an admin typed
 * into a dashboard form. The PIN a supervisor knows must not be the one left
 * guarding the custody chain.
 */
export function PinChangeScreen({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (next !== confirm) { setError('The two new PINs do not match.'); return; }
    setBusy(true); setError('');
    void (async () => {
      try {
        await changeOwnPin(current, next);
        onDone();
      } catch (err) {
        setError(fieldError(err, 'Could not change the PIN.'));
      } finally {
        setBusy(false);
      }
    })();
  };

  const field = (label: string, value: string, set: (v: string) => void, id: string) => (
    <div>
      <label htmlFor={id} className="text-[11px] font-mono uppercase tracking-widest text-text-2">{label}</label>
      <input
        id={id}
        value={value}
        onChange={e => set(e.target.value.replace(/\D/g, '').slice(0, 8))}
        inputMode="numeric"
        type="password"
        autoComplete="off"
        className="mt-1.5 w-full h-14 rounded-xl bg-white/[.04] border border-white/[.12] px-4 text-[22px] font-mono tracking-[.4em] text-center outline-none focus:border-cds-orange/60 transition-colors"
      />
    </div>
  );

  return (
    <div className="min-h-screen w-full bg-ink-0 text-text-0 relative overflow-hidden flex flex-col">
      <Backdrop />
      <Brand caption="Pick a PIN only you know before you start work." />
      <form onSubmit={submit} className="relative flex-1 px-6 space-y-4">
        {field('Current PIN', current, setCurrent, 'currentPin')}
        {field('New PIN', next, setNext, 'newPin')}
        {field('Confirm new PIN', confirm, setConfirm, 'confirmPin')}
        <p className="text-[11px] text-text-2 leading-snug">
          4 to 8 digits. Avoid runs like 1234 and repeated digits — they are rejected.
        </p>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="pt-2 pb-8">
          <button
            type="submit"
            disabled={busy || next.length < 4 || current.length < 4}
            className="w-full h-16 rounded-2xl font-bold text-[16px] flex items-center justify-center gap-2 disabled:opacity-35 active:scale-[.985] transition-all"
            style={{ background: 'linear-gradient(135deg, #ff7a00, #F0B429)', color: '#170d00' }}
          >
            {busy ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={18} />} Set my PIN
          </button>
        </div>
      </form>
    </div>
  );
}
