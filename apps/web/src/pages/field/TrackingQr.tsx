import { AlertTriangle, Check, CloudOff, Loader2, ShieldAlert } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/**
 * The driver's tracking QR, shown to the yard worker straight after a clamp.
 *
 * This screen exists because the token behind the code is issued EXACTLY ONCE.
 * The server stores only its SHA-256 hash (see trackingEngine.issueQr), so the
 * raw value in `url` cannot be looked up again by anyone, including the control
 * room — GET /tracking/qr deliberately does not return it. If this screen is
 * dismissed before the driver scans, the only recovery is for the control room
 * to revoke and re-issue.
 *
 * Two consequences shape the whole component:
 *   • it never auto-dismisses, and never closes on a stray tap
 *   • it says plainly that the code will not be shown again
 *
 * The code is drawn on forced white at high error correction. Yard phones run
 * this dark theme, and a dark or low-contrast code in daylight, behind a cracked
 * screen protector, simply does not scan.
 */

export interface IssuedTracking {
  qr_id: string;
  token: string;
  url: string;
}

/** Renders the code itself, or says why it cannot. */
function QrCanvas({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, {
      errorCorrectionLevel: 'Q',   // dusty cabs, cracked screens, glare
      margin: 2,
      width: 720,
      color: { dark: '#000000', light: '#ffffff' },
    }).then(
      (d) => { if (!cancelled) setSrc(d); },
      () => { if (!cancelled) setFailed(true); },
    );
    return () => { cancelled = true; };
  }, [url]);

  if (failed) {
    return (
      <div className="w-full aspect-square rounded-2xl bg-white/[.04] border border-white/10 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <ShieldAlert size={30} className="text-[#ff5c5c]" />
        <div className="text-[13px] font-bold text-text-0">Could not draw the code</div>
        <div className="text-[11px] font-mono text-text-2 break-all leading-relaxed">{url}</div>
        <div className="text-[10px] font-mono text-text-2/70">
          Type this link into the driver&apos;s browser instead.
        </div>
      </div>
    );
  }

  if (!src) {
    return (
      <div className="w-full aspect-square rounded-2xl bg-white/[.04] border border-white/10 flex items-center justify-center">
        <Loader2 size={26} className="animate-spin text-text-2" />
      </div>
    );
  }

  return (
    // White is not decoration here — it is what makes the code scannable.
    <div className="w-full rounded-2xl bg-white p-4 shadow-[0_0_60px_-12px_rgba(255,255,255,.25)]">
      <img src={src} alt="Tracking QR code for the driver to scan" className="w-full block" />
    </div>
  );
}

/**
 * Post-clamp result screen.
 *
 * `tracking` present  → the code, held until the worker confirms the scan.
 * `tracking` null     → the clamp landed but no code was issued. That is a real
 *                       state (issuance is deliberately non-fatal so a tracking
 *                       hiccup can never block a physical clamp), and it must
 *                       be said out loud rather than shown as a blank space.
 * `queued`            → nothing reached the server yet, so no code can exist.
 */
export function ClampResult({
  mode, label, tracking, onDone,
}: {
  mode: 'submitted' | 'queued';
  label: string;
  tracking: IssuedTracking | null;
  onDone: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);

  if (mode === 'queued') {
    return (
      <Result
        accent="#ffb020"
        icon={<CloudOff size={34} style={{ color: '#ffb020' }} strokeWidth={2.2} />}
        title="Saved on device"
        line={`${label} · not yet sent`}
        note="Will sync automatically when back online"
      >
        <Notice tone="warn">
          No tracking QR yet. The code is issued by the server, so this clamp has
          none until it syncs. Check Pending sync, or ask the control room to
          issue one for the driver.
        </Notice>
        <PrimaryButton onClick={onDone}>Done</PrimaryButton>
      </Result>
    );
  }

  if (!tracking) {
    return (
      <Result
        accent="#33d6a8"
        icon={<Check size={38} style={{ color: '#33d6a8' }} strokeWidth={2.5} />}
        title="Clamped"
        line={`${label} · Trip created`}
        note="CDS control room notified"
      >
        <Notice tone="warn">
          The clamp is recorded, but a tracking QR was not issued. The container
          is not being tracked. Ask the control room to issue a code before the
          truck leaves.
        </Notice>
        <PrimaryButton onClick={onDone}>Done</PrimaryButton>
      </Result>
    );
  }

  return (
    <div className="min-h-screen bg-ink-0 text-text-0 flex flex-col">
      <div className="px-5 pt-6 pb-3 text-center">
        <div className="inline-flex items-center gap-2 text-[10px] font-bold font-mono uppercase tracking-widest text-[#33d6a8]">
          <Check size={13} strokeWidth={3} /> Clamped · {label}
        </div>
        <h1 className="text-[19px] font-bold mt-2">Driver scans this now</h1>
        <p className="text-[12px] text-text-2 mt-1 leading-relaxed">
          Tracking starts when the driver scans and allows location.
        </p>
      </div>

      <div className="px-6 flex-1 flex items-center justify-center">
        <div className="w-full max-w-[320px]">
          <QrCanvas url={tracking.url} />
        </div>
      </div>

      <div className="px-5 pb-6 pt-4 space-y-3">
        <Notice tone="danger">
          <span className="font-bold">This code is shown once.</span> It cannot be
          opened again from any screen. If you leave before the driver scans, the
          control room has to issue a new one.
        </Notice>

        {!confirmed ? (
          <PrimaryButton onClick={() => setConfirmed(true)}>
            The driver has scanned it
          </PrimaryButton>
        ) : (
          <div className="space-y-2.5">
            <div className="text-center text-[11px] font-mono text-text-2 leading-relaxed">
              Close only when the driver&apos;s phone shows tracking has started.
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => setConfirmed(false)}
                className="h-12 rounded-xl border border-white/12 text-[13px] font-bold text-text-1 active:scale-[.98] transition"
              >
                Show again
              </button>
              <button
                onClick={onDone}
                className="h-12 rounded-xl bg-cds-orange text-black text-[13px] font-bold active:scale-[.98] transition"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Shared shell ─────────────────────────────────────────────────────────── */

function Result({
  accent, icon, title, line, note, children,
}: {
  accent: string; icon: React.ReactNode; title: string; line: string;
  note: string; children?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-ink-0 text-text-0 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-30"
        style={{ background: `radial-gradient(circle at 50% 40%, ${accent}40, transparent 55%)` }} />
      <div className="relative w-20 h-20 rounded-full flex items-center justify-center mb-5"
        style={{ background: `${accent}26`, border: `2px solid ${accent}80`, boxShadow: `0 0 40px -8px ${accent}99` }}>
        {icon}
      </div>
      <div className="relative text-xl font-bold">{title}</div>
      <div className="relative text-[12px] font-mono text-text-2 mt-1.5">{line}</div>
      <div className="relative text-[10px] font-mono text-text-2/60 mt-0.5">{note}</div>
      <div className="relative w-full max-w-[360px] mt-6 space-y-3">{children}</div>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'warn' | 'danger'; children: React.ReactNode }) {
  const c = tone === 'danger' ? '#ff5c5c' : '#ffb020';
  return (
    <div className="flex gap-2.5 rounded-xl p-3 border text-[11px] leading-relaxed"
      style={{ background: `${c}14`, borderColor: `${c}44`, color: '#d8dee9' }}>
      <AlertTriangle size={15} style={{ color: c, flexShrink: 0, marginTop: 1 }} />
      <div>{children}</div>
    </div>
  );
}

function PrimaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full h-12 rounded-xl bg-cds-orange text-black text-[13px] font-bold active:scale-[.98] transition"
    >
      {children}
    </button>
  );
}

/* ─── QRs that arrived during background sync ──────────────────────────────── */

/**
 * One unshown code from the offline queue, expandable to full screen.
 *
 * A clamp queued in a dead zone is posted later by the sync loop, and the
 * server issues the driver's code in that response — while nobody is looking at
 * it. The queue holds it (see offlineQueue.IssuedQr) and this is where a worker
 * finally presents it. Dismissal is explicit and one-way, because the code
 * cannot be fetched again.
 */
export function PendingQrSheet({
  qr, onShown,
}: {
  qr: { id: string; label: string; qr_id: string; url: string; issuedAt: number };
  onShown: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 rounded-lg bg-black/25 px-2.5 py-2 text-left active:scale-[.99] transition"
      >
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-mono font-bold text-text-1 truncate">{qr.label}</div>
          <div className="text-[10px] text-text-2 mt-0.5">Tap to show the driver</div>
        </div>
        <span className="text-[10px] font-mono font-bold text-cds-orange flex-shrink-0">SHOW</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink-0 flex flex-col overflow-y-auto">
      <div className="px-5 pt-6 pb-3 text-center">
        <div className="text-[10px] font-bold font-mono uppercase tracking-widest text-cds-orange">
          Synced clamp · {qr.label}
        </div>
        <h1 className="text-[19px] font-bold mt-2">Driver scans this now</h1>
        <p className="text-[12px] text-text-2 mt-1 leading-relaxed">
          Tracking starts when the driver scans and allows location.
        </p>
      </div>

      <div className="px-6 flex-1 flex items-center justify-center py-2">
        <div className="w-full max-w-[320px]"><QrCanvas url={qr.url} /></div>
      </div>

      <div className="px-5 pb-6 pt-4 space-y-3">
        <Notice tone="danger">
          <span className="font-bold">Shown once.</span> Dismissing this removes it
          for good — the control room would have to issue a new code.
        </Notice>
        {!confirming ? (
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={() => setOpen(false)}
              className="h-12 rounded-xl border border-white/12 text-[13px] font-bold text-text-1 active:scale-[.98] transition"
            >
              Keep for later
            </button>
            <button
              onClick={() => setConfirming(true)}
              className="h-12 rounded-xl bg-cds-orange text-black text-[13px] font-bold active:scale-[.98] transition"
            >
              Driver scanned it
            </button>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="text-center text-[11px] font-mono text-text-2 leading-relaxed">
              Confirm only if the driver&apos;s phone shows tracking has started.
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => setConfirming(false)}
                className="h-12 rounded-xl border border-white/12 text-[13px] font-bold text-text-1 active:scale-[.98] transition"
              >
                Not yet
              </button>
              <button
                onClick={() => { setOpen(false); onShown(); }}
                className="h-12 rounded-xl bg-[#33d6a8] text-black text-[13px] font-bold active:scale-[.98] transition"
              >
                Confirm &amp; remove
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
