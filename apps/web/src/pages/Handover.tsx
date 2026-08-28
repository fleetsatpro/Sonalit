import { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Truck, ClipboardCheck, Loader2, AlertCircle,
  ArrowRight, FileText, MapPin, CircleDot,
  User, X, ChevronLeft, Upload, Shield, Check,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useHandoverHeader } from './HandoverShell.js';

interface HandoverQueueItem {
  id: string;
  name: string;
  region: string;
  route_origin: string;
  route_destination: string;
  truck_count: number;
  trucks_handed_over: number;
  convoy_wide_handover: boolean;
}

interface HandoverTruck {
  id: string;
  position: number;
  plate_number: string | null;
  driver_name: string | null;
}

interface HandoverRecord {
  id: string;
  convoy_truck_id: string | null;
  handed_over_by_role: 'cfo' | 'handover_officer';
  form_url: string;
  selfie_url: string | null;
  notes: string | null;
  signed_off_at: string;
}

interface HandoverDetail {
  convoy: { id: string; name: string; region: string; route_origin: string; route_destination: string; status: string };
  trucks: HandoverTruck[];
  handovers: HandoverRecord[];
}

type QueueFilter = 'all' | 'pending' | 'in_progress' | 'done';
type Tone = 'muted' | 'accent' | 'ok' | 'warn';

/* ── Badge — pill matching Grok's Badge anatomy ─────────────────────── */

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`ho-badge ho-badge-${tone}`}>{children}</span>;
}

function StatusDot({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className={`ho-status ho-status-${tone}`}>
      <span className="ho-status-dot" />
      {label}
    </span>
  );
}

/* ── Upload row — one truck or whole-convoy ─────────────────────────── */

function UploadRow({
  convoyId, truckId, label, subtitle, alreadyDone, onDone,
}: {
  convoyId: string; truckId: string | null;
  label: string; subtitle?: string;
  alreadyDone: boolean; onDone: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [selfieBlob, setSelfieBlob] = useState<Blob | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selfieRef = useRef<HTMLInputElement>(null);

  const clearSelfie = () => {
    setSelfieBlob(null);
    if (selfiePreview) { URL.revokeObjectURL(selfiePreview); setSelfiePreview(null); }
  };

  const onSelfieCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      setSelfieBlob(file);
      setSelfiePreview(URL.createObjectURL(file));
      setError(null);
    }
  };

  const submit = useMutation({
    mutationFn: async (file: File) => {
      if (!selfieBlob) throw new Error('Selfie sign-off is required before uploading the form');
      const content_type = file.type === 'application/pdf' ? 'application/pdf' : 'image/jpeg';

      const [formPresign, selfiePresign] = await Promise.all([
        api.post<{ upload_url: string; public_url: string; key: string }>(
          `/convoy-handovers/${convoyId}/upload-url`,
          { truck_id: truckId, content_type },
        ).then(r => r.data),
        api.post<{ upload_url: string; public_url: string; key: string }>(
          `/convoy-handovers/${convoyId}/selfie-url`,
          { truck_id: truckId },
        ).then(r => r.data),
      ]);

      const [putForm, putSelfie] = await Promise.all([
        fetch(formPresign.upload_url, { method: 'PUT', body: file, headers: { 'Content-Type': content_type } }),
        fetch(selfiePresign.upload_url, { method: 'PUT', body: selfieBlob, headers: { 'Content-Type': 'image/jpeg' } }),
      ]);
      if (!putForm.ok) throw new Error(`Form upload failed (${putForm.status})`);
      if (!putSelfie.ok) throw new Error(`Selfie upload failed (${putSelfie.status})`);

      await api.post(`/convoy-handovers/${convoyId}/commit`, {
        truck_id: truckId,
        form_key: formPresign.key, form_url: formPresign.public_url,
        selfie_key: selfiePresign.key, selfie_url: selfiePresign.public_url,
        notes: notes || undefined,
      });
    },
    onSuccess: () => { setNotes(''); setShowNotes(false); clearSelfie(); onDone(); },
    onError: (err: Error) => setError(err.message || 'Upload failed'),
  });

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      if (!selfieBlob) { setError('Take your selfie sign-off first'); return; }
      setError(null);
      submit.mutate(file);
    }
  };

  if (alreadyDone) {
    return (
      <div className="ho-row ho-row-done">
        <div className="ho-row-check"><Check size={16} /></div>
        <div className="ho-row-info">
          <div className="ho-row-label">{label}</div>
          {subtitle && <div className="ho-row-sub">{subtitle}</div>}
        </div>
        <StatusDot tone="ok" label="Signed off" />
      </div>
    );
  }

  return (
    <div className="ho-row">
      <div className="ho-row-body">
        <div className="ho-row-top-info">
          <div className="ho-row-icon"><Truck size={15} /></div>
          <div className="ho-row-info">
            <div className="ho-row-label">{label}</div>
            {subtitle && <div className="ho-row-sub">{subtitle}</div>}
          </div>
        </div>

        <div className="ho-steps-track">
          <div className={`ho-step ${selfieBlob ? 'ho-step-complete' : ''}`}>
            <div className="ho-step-indicator">
              {selfieBlob
                ? <Check size={14} />
                : <span className="ho-step-num-text">1</span>}
            </div>
            <div className="ho-step-content">
              <div className="ho-kicker">Selfie sign-off</div>
              {selfiePreview ? (
                <div className="ho-selfie-preview-wrap">
                  <img src={selfiePreview} alt="Selfie" className="ho-selfie-img" />
                  <button className="ho-selfie-remove" onClick={clearSelfie} aria-label="Remove selfie"><X size={12} /></button>
                </div>
              ) : (
                <button className="ho-action-btn ho-action-btn-outline" onClick={() => selfieRef.current?.click()}>
                  <User size={13} /> Take selfie
                </button>
              )}
              <input ref={selfieRef} type="file" accept="image/jpeg,image/*" capture="user" className="ho-sr-only" onChange={onSelfieCapture} />
            </div>
          </div>

          <div className="ho-step-connector" />

          <div className={`ho-step ${!selfieBlob ? 'ho-step-locked' : ''}`}>
            <div className="ho-step-indicator">
              <span className="ho-step-num-text">2</span>
            </div>
            <div className="ho-step-content">
              <div className="ho-kicker">Upload handover form</div>
              <button
                className="ho-action-btn ho-action-btn-primary"
                disabled={submit.isPending || !selfieBlob}
                onClick={() => fileRef.current?.click()}
              >
                {submit.isPending
                  ? <><Loader2 size={13} className="ho-spin" /> Uploading…</>
                  : <><Upload size={13} /> Upload form</>}
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/jpeg,application/pdf" className="ho-sr-only" onChange={onFile} disabled={submit.isPending || !selfieBlob} />
          </div>
        </div>

        <div className="ho-row-extras">
          <button className="ho-notes-toggle" onClick={() => setShowNotes(!showNotes)}>
            <FileText size={11} /> {showNotes ? 'Hide notes' : 'Add notes'}
          </button>
          {showNotes && (
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional handover notes…"
              className="ho-notes-input"
            />
          )}
          {error && (
            <div className="ho-error">
              <AlertCircle size={12} /> {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Skeleton loaders ──────────────────────────────────────────────── */

function QueueSkeleton() {
  return (
    <div className="ho-q-list ho-stagger">
      {[0, 1, 2].map((i) => (
        <div key={i} className="ho-skel-card" style={{ '--stagger': i } as React.CSSProperties}>
          <div className="ho-skel-line ho-skel-w60" />
          <div className="ho-skel-line ho-skel-w40" style={{ marginTop: 8 }} />
          <div className="ho-skel-bar" style={{ marginTop: 12 }} />
        </div>
      ))}
    </div>
  );
}

/* ── Convoy detail — selected convoy's trucks ───────────────────────── */

function ConvoyDetail({ convoyId, onBack }: { convoyId: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const setHeader = useHandoverHeader();
  const { data, isLoading } = useQuery({
    queryKey: ['convoy-handover-detail', convoyId],
    queryFn: async () => (await api.get<{ data: HandoverDetail }>(`/convoy-handovers/${convoyId}`)).data.data,
    refetchInterval: 5000,
  });

  useEffect(() => {
    setHeader({
      title: data?.convoy.name ?? 'Convoy',
      subtitle: 'Trucks, route, and handover progress',
      icon: <Shield size={18} strokeWidth={2} />,
    });
  }, [data?.convoy.name, setHeader]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['convoy-handover-detail', convoyId] });
    void queryClient.invalidateQueries({ queryKey: ['convoy-handover-queue'] });
  };

  if (isLoading || !data) {
    return (
      <div className="ho-detail">
        <button className="ho-detail-back" onClick={onBack}>
          <ChevronLeft size={16} /> Back
        </button>
        <div className="ho-skel-card" style={{ padding: 20 }}>
          <div className="ho-skel-line ho-skel-w60" />
          <div className="ho-skel-line ho-skel-w40" style={{ marginTop: 10 }} />
          <div className="ho-skel-bar" style={{ marginTop: 16 }} />
        </div>
      </div>
    );
  }

  if (data.convoy.status !== 'completing') {
    return (
      <div className="ho-complete-wrap">
        <div className="ho-empty-ring-wrap">
          <span className="ho-empty-ring-outer" />
          <span className="ho-empty-ring-inner ho-ring-ok">
            <Check size={28} strokeWidth={2.2} />
          </span>
        </div>
        <h2 className="ho-empty-title">All clear</h2>
        <p className="ho-empty-sub">
          <strong>{data.convoy.name}</strong> — all trucks handed over successfully.
        </p>
        <button className="ho-complete-btn" onClick={onBack}>
          <ChevronLeft size={14} /> Back to queue
        </button>
      </div>
    );
  }

  const convoyWide = data.handovers.find((h) => h.convoy_truck_id === null) ?? null;
  const truckDone = (truckId: string) => data.handovers.some((h) => h.convoy_truck_id === truckId);
  const doneCount = convoyWide ? data.trucks.length : data.trucks.filter(t => truckDone(t.id)).length;
  const pct = data.trucks.length > 0 ? Math.round((doneCount / data.trucks.length) * 100) : 0;

  return (
    <div className="ho-detail">
      <button className="ho-detail-back" onClick={onBack}>
        <ChevronLeft size={16} /> Back
      </button>

      {/* Convoy info card */}
      <div className="ho-info-card ho-hairline">
        <div className="ho-info-route">
          <div className="ho-route-point">
            <CircleDot size={12} />
            <span>{data.convoy.route_origin}</span>
          </div>
          <div className="ho-route-line" />
          <div className="ho-route-point ho-route-dest">
            <MapPin size={12} />
            <span>{data.convoy.route_destination}</span>
          </div>
        </div>

        <div className="ho-progress-section">
          <div className="ho-progress-header">
            <span className="ho-kicker">{doneCount} of {data.trucks.length} trucks</span>
            <span className="ho-progress-pct">{pct}%</span>
          </div>
          <div className="ho-progress-track">
            <div className="ho-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {/* Whole convoy handover */}
      <div className="ho-section">
        <div className="ho-kicker" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <ClipboardCheck size={12} />
          <span>Whole convoy handover</span>
        </div>
        <div className="ho-card-plain ho-hairline">
          <UploadRow
            convoyId={convoyId}
            truckId={null}
            label="Complete convoy"
            subtitle="Upload one form covering all trucks"
            alreadyDone={!!convoyWide}
            onDone={refresh}
          />
        </div>
      </div>

      {/* Truck-by-truck */}
      {!convoyWide && data.trucks.length > 0 && (
        <>
          <div className="ho-divider-row">
            <div className="ho-divider-line" />
            <span className="ho-kicker" style={{ flexShrink: 0, padding: '0 4px' }}>or truck by truck</span>
            <div className="ho-divider-line" />
          </div>

          <div className="ho-card-plain ho-hairline">
            {data.trucks.map((t, i) => (
              <div key={t.id} className={i > 0 ? 'ho-truck-sep' : ''}>
                <UploadRow
                  convoyId={convoyId}
                  truckId={t.id}
                  label={`Truck ${t.position} — ${t.plate_number ?? 'Unregistered'}`}
                  {...(t.driver_name ? { subtitle: t.driver_name } : {})}
                  alreadyDone={truckDone(t.id)}
                  onDone={refresh}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Filter pills ──────────────────────────────────────────────────── */

const FILTERS: { key: QueueFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'done', label: 'Done' },
];

function applyFilter(queue: HandoverQueueItem[], filter: QueueFilter): HandoverQueueItem[] {
  switch (filter) {
    case 'pending': return queue.filter(c => c.trucks_handed_over === 0 && !c.convoy_wide_handover);
    case 'in_progress': return queue.filter(c => c.trucks_handed_over > 0 && c.trucks_handed_over < c.truck_count && !c.convoy_wide_handover);
    case 'done': return queue.filter(c => c.convoy_wide_handover || c.trucks_handed_over >= c.truck_count);
    default: return queue;
  }
}

function progressTone(pct: number, isDone: boolean): Tone {
  if (isDone) return 'ok';
  if (pct > 0) return 'accent';
  return 'muted';
}

/* ── Queue list — the main page ─────────────────────────────────────── */

export default function Handover() {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>('all');
  const queryClient = useQueryClient();
  const setHeader = useHandoverHeader();

  const { data: queue, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['convoy-handover-queue'],
    queryFn: async () => (await api.get<{ data: HandoverQueueItem[] }>('/convoy-handovers/queue')).data.data,
    refetchInterval: 10000,
  });

  const manualRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['convoy-handover-queue'] });
  }, [queryClient]);

  useEffect(() => {
    if (selected) return;
    setHeader({
      title: 'Handover Queue',
      subtitle: 'Convoys awaiting signed handover forms',
      icon: <ClipboardCheck size={18} strokeWidth={2} />,
      onRefresh: manualRefresh,
    });
  }, [selected, setHeader, manualRefresh]);

  if (selected) {
    return (
      <div className="ho-page">
        <ConvoyDetail convoyId={selected} onBack={() => setSelected(null)} />
        <HandoverStyles />
      </div>
    );
  }

  const filtered = queue ? applyFilter(queue, filter) : [];

  return (
    <div className="ho-page">
      <div className="ho-queue">
        {/* Filter pills — always visible, even when the queue is empty */}
        <div className="ho-filter-row">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`ho-pill ${filter === f.key ? 'ho-pill-active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Skeleton loading */}
        {isLoading && <QueueSkeleton />}

        {/* Empty state — Grok double-ring pattern */}
        {!isLoading && filtered.length === 0 && (
          <div className="ho-empty">
            <div className="ho-empty-ring-wrap">
              <span className="ho-empty-ring-outer" />
              <span className="ho-empty-ring-inner">
                <Check size={28} strokeWidth={2.2} />
              </span>
            </div>
            <h2 className="ho-empty-title">All clear</h2>
            <p className="ho-empty-sub">
              {queue && queue.length > 0
                ? 'No convoys match this filter.'
                : 'No convoys awaiting handover right now. Queue refreshes automatically.'}
            </p>
            {dataUpdatedAt > 0 && (
              <p className="ho-empty-checked">
                Last checked {new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
        )}

        {/* Queue cards — stagger-in */}
        {!isLoading && filtered.length > 0 && (
          <div className="ho-q-list ho-stagger">
            {filtered.map((c, i) => {
              const pct = c.truck_count > 0 ? Math.round((c.trucks_handed_over / c.truck_count) * 100) : 0;
              const isDone = c.convoy_wide_handover || pct >= 100;
              const tone = progressTone(pct, isDone);
              const label = isDone ? 'Complete' : pct > 0 ? 'In progress' : 'Pending';

              return (
                <button
                  key={c.id}
                  className="ho-q-card ho-hairline ho-hairline-hover"
                  onClick={() => setSelected(c.id)}
                  style={{ '--stagger': i } as React.CSSProperties}
                >
                  <span className={`ho-priority-rail ho-rail-${tone}`} aria-hidden="true" />

                  <div className="ho-q-card-header">
                    <div className="ho-q-card-id-row">
                      <span className="ho-q-card-region-tag">{c.region}</span>
                      <Badge tone={tone}>{label}</Badge>
                    </div>
                    <StatusDot tone={tone} label={isDone ? 'Complete' : 'Awaiting'} />
                  </div>

                  <p className="ho-q-card-name">{c.name}</p>
                  <p className="ho-q-card-route">
                    <span>{c.route_origin}</span>
                    <ArrowRight size={9} />
                    <span>{c.route_destination}</span>
                  </p>

                  <div className="ho-q-card-meta">
                    <span className="ho-q-card-meta-item">
                      <Truck size={12} />
                      {c.truck_count} {c.truck_count === 1 ? 'vehicle' : 'vehicles'}
                    </span>
                    {c.convoy_wide_handover && <span className="ho-q-card-accent-tag">Convoy-wide</span>}
                  </div>

                  <div className="ho-q-card-progress">
                    <div className="ho-q-card-progress-row">
                      <span className="ho-q-card-progress-label">{c.trucks_handed_over} of {c.truck_count} trucks</span>
                      <span className={`ho-q-card-progress-pct ho-tone-${tone}`}>{pct}%</span>
                    </div>
                    <div className="ho-q-progress-track">
                      <div className={`ho-q-progress-fill ho-fill-${tone}`} style={{ width: `${Math.max(4, pct)}%` }} />
                    </div>
                  </div>

                  <div className="ho-q-card-footer">
                    <span className="ho-q-card-footer-region">{c.region}</span>
                    <span className="ho-q-card-open">
                      Open <ArrowRight size={12} />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <HandoverStyles />
    </div>
  );
}

/* ── All styles ─────────────────────────────────────────────────────── */

function HandoverStyles() {
  return (
    <style>{`
      /* ── Page ─────────────────────────────────── */
      .ho-page {
        min-height: 100%;
        background: var(--d-void);
        padding: 0 0 env(safe-area-inset-bottom, 0);
      }

      /* ── Hairline (Grok box-shadow border) ────── */
      .ho-hairline {
        box-shadow: 0 0 0 1px rgba(232,238,247,.08);
      }
      .ho-hairline-hover:hover {
        box-shadow: 0 0 0 1px rgba(232,238,247,.14);
      }

      /* ── Kicker label (Grok pattern) ──────────── */
      .ho-kicker {
        font-family: var(--d-font-mono);
        font-size: 11px;
        font-weight: 500;
        letter-spacing: .16em;
        text-transform: uppercase;
        color: var(--d-t2);
        line-height: 1;
      }

      /* ── Stagger-in animation (Grok rise-in) ──── */
      .ho-stagger > * {
        animation: ho-rise-in 400ms cubic-bezier(0.22, 1, 0.36, 1) both;
        animation-delay: calc(var(--stagger, 0) * 40ms);
      }

      @keyframes ho-rise-in {
        from {
          opacity: 0;
          transform: translateY(8px);
          filter: blur(2px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
        }
      }

      /* ── Badge (Grok Badge component) ─────────── */
      .ho-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border-radius: 999px;
        font-family: var(--d-font);
        font-size: 11px;
        font-weight: 500;
        letter-spacing: .02em;
        line-height: 1.4;
      }
      .ho-badge-muted { background: var(--d-well); color: var(--d-t2); }
      .ho-badge-accent { background: rgba(34,232,255,.12); color: var(--d-sig); }
      .ho-badge-ok { background: rgba(41,255,176,.12); color: var(--d-ok); }
      .ho-badge-warn { background: rgba(255,180,60,.12); color: var(--d-warn); }

      /* ── Status dot pill (Grok StatusBadge) ───── */
      .ho-status {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 2px 10px;
        border-radius: 999px;
        font-family: var(--d-font-mono);
        font-size: 10px;
        font-weight: 600;
        flex-shrink: 0;
      }
      .ho-status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        display: inline-block;
      }
      .ho-status-muted { background: var(--d-well); color: var(--d-t2); }
      .ho-status-muted .ho-status-dot { background: var(--d-t2); }
      .ho-status-accent { background: rgba(34,232,255,.1); color: var(--d-sig); }
      .ho-status-accent .ho-status-dot { background: var(--d-sig); }
      .ho-status-ok { background: rgba(41,255,176,.1); color: var(--d-ok); }
      .ho-status-ok .ho-status-dot { background: var(--d-ok); }
      .ho-status-warn { background: rgba(255,180,60,.1); color: var(--d-warn); }
      .ho-status-warn .ho-status-dot { background: var(--d-warn); }

      .ho-tone-muted { color: var(--d-t2); }
      .ho-tone-accent { color: var(--d-sig); }
      .ho-tone-ok { color: var(--d-ok); }
      .ho-tone-warn { color: var(--d-warn); }

      /* ── Queue layout ────────────────────────── */
      .ho-queue {
        max-width: 520px;
        margin: 0 auto;
        padding: 16px 16px 40px;
      }

      /* ── Filter pills (Grok pattern) ──────────── */
      .ho-filter-row {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        padding: 2px 0;
      }
      .ho-filter-row::-webkit-scrollbar { display: none; }

      .ho-pill {
        display: inline-flex;
        align-items: center;
        height: 36px;
        padding: 0 14px;
        border-radius: 999px;
        border: none;
        background: var(--d-well);
        color: var(--d-t2);
        font-family: var(--d-font);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        white-space: nowrap;
        transition: all .15s;
        -webkit-tap-highlight-color: transparent;
        flex-shrink: 0;
      }
      .ho-pill:hover {
        color: var(--d-t1);
      }
      .ho-pill-active {
        background: var(--d-sig);
        color: var(--d-void);
      }
      .ho-pill-active:hover {
        color: var(--d-void);
      }

      /* ── Queue cards ─────────────────────────── */
      .ho-q-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .ho-q-card {
        position: relative;
        display: block;
        width: 100%;
        text-align: left;
        background: var(--d-deep);
        border: none;
        border-radius: 24px;
        padding: 16px 16px 16px 20px;
        cursor: pointer;
        transition: box-shadow .15s ease, transform .15s ease;
        -webkit-tap-highlight-color: transparent;
      }
      .ho-q-card:active {
        transform: scale(.99);
      }

      /* ── Priority rail (Grok: absolute inset-y-3 left-0 w-0.5) ── */
      .ho-priority-rail {
        position: absolute;
        top: 12px;
        bottom: 12px;
        left: 0;
        width: 2px;
        border-radius: 999px;
      }
      .ho-rail-ok { background: var(--d-ok); }
      .ho-rail-accent { background: var(--d-sig); }
      .ho-rail-muted { background: var(--d-rim3); }
      .ho-rail-warn { background: var(--d-warn); }

      .ho-q-card-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
      }

      .ho-q-card-id-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .ho-q-card-region-tag {
        font-family: var(--d-font-mono);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: .02em;
        color: var(--d-t1);
      }

      .ho-q-card-name {
        margin: 6px 0 0;
        font-family: var(--d-font);
        font-size: 14px;
        font-weight: 500;
        color: var(--d-t1);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ho-q-card-route {
        display: flex;
        align-items: center;
        gap: 5px;
        margin: 2px 0 0;
        font-size: 12px;
        color: var(--d-t2);
      }

      .ho-q-card-meta {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-top: 12px;
        flex-wrap: wrap;
      }

      .ho-q-card-meta-item {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 12px;
        color: var(--d-t2);
      }

      .ho-q-card-accent-tag {
        font-size: 12px;
        color: var(--d-sig);
      }

      .ho-q-card-progress {
        margin-top: 12px;
      }

      .ho-q-card-progress-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
      }

      .ho-q-card-progress-label {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: var(--d-t2);
      }

      .ho-q-card-progress-pct {
        font-family: var(--d-font-mono);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
      }

      .ho-q-progress-track {
        height: 4px;
        border-radius: 999px;
        background: var(--d-well);
        overflow: hidden;
      }

      .ho-q-progress-fill {
        height: 100%;
        border-radius: 999px;
        transition: width .5s ease;
      }
      .ho-fill-ok { background: var(--d-ok); }
      .ho-fill-accent { background: var(--d-sig); }
      .ho-fill-muted { background: var(--d-t3); }
      .ho-fill-warn { background: var(--d-warn); }

      .ho-q-card-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 12px;
      }

      .ho-q-card-footer-region {
        font-size: 11px;
        color: var(--d-t3);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ho-q-card-open {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: var(--d-sig);
        flex-shrink: 0;
      }

      /* ── Empty state (Grok EmptyClear — exact proportions) ───── */
      .ho-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: 64px 24px 16px;
        animation: ho-rise-in .4s ease both;
      }

      .ho-empty-ring-wrap {
        position: relative;
        width: 80px;
        height: 80px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .ho-empty-ring-outer {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        border: 1px solid rgba(34,232,255,.25);
      }

      .ho-empty-ring-inner {
        position: relative;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        border: 1.5px solid rgba(34,232,255,.5);
        color: var(--d-sig);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .ho-empty-ring-inner.ho-ring-ok {
        border-color: rgba(41,255,176,.5);
        color: var(--d-ok);
      }

      .ho-empty-title {
        margin: 32px 0 0;
        font-family: var(--d-font);
        font-size: 24px;
        font-weight: 500;
        letter-spacing: -.02em;
        color: var(--d-t1);
      }

      .ho-empty-sub {
        margin: 8px 0 0;
        max-width: 320px;
        font-size: 14px;
        color: var(--d-t2);
        line-height: 1.5;
      }

      .ho-empty-checked {
        margin: 24px 0 0;
        font-size: 12px;
        color: var(--d-t3);
      }

      /* ── Detail view ─────────────────────────── */
      .ho-detail {
        max-width: 520px;
        margin: 0 auto;
        padding: 16px 16px 40px;
        animation: ho-rise-in .3s ease both;
      }

      .ho-detail-back {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: none;
        border: none;
        color: var(--d-sig);
        font-family: var(--d-font);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        padding: 6px 2px;
        margin-bottom: 16px;
        transition: opacity .15s;
      }
      .ho-detail-back:hover { opacity: .8; }

      /* ── Info card ───────────────────────────── */
      .ho-info-card {
        background: var(--d-deep);
        border-radius: 24px;
        padding: 18px 20px;
        margin-bottom: 24px;
      }

      .ho-info-route {
        display: flex;
        align-items: center;
        gap: 0;
        padding: 12px 14px;
        background: var(--d-void);
        border-radius: 14px;
        margin-bottom: 16px;
      }

      .ho-route-point {
        display: flex;
        align-items: center;
        gap: 6px;
        font-family: var(--d-font-mono);
        font-size: 11px;
        color: var(--d-t1);
        flex-shrink: 0;
      }
      .ho-route-point svg { color: var(--d-sig); flex-shrink: 0; }
      .ho-route-dest svg { color: var(--d-ok); }

      .ho-route-line {
        flex: 1;
        height: 1px;
        min-width: 16px;
        margin: 0 10px;
        background: repeating-linear-gradient(90deg, var(--d-rim3) 0, var(--d-rim3) 4px, transparent 4px, transparent 8px);
      }

      .ho-progress-section { }

      .ho-progress-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }

      .ho-progress-pct {
        font-family: var(--d-font-mono);
        font-size: 12px;
        font-weight: 700;
        color: var(--d-sig);
      }

      .ho-progress-track {
        height: 4px;
        border-radius: 999px;
        background: var(--d-well);
        overflow: hidden;
      }

      .ho-progress-fill {
        height: 100%;
        border-radius: 999px;
        background: var(--d-sig);
        transition: width .5s ease;
      }

      /* ── Sections ────────────────────────────── */
      .ho-section {
        margin-bottom: 0;
      }

      .ho-card-plain {
        background: var(--d-deep);
        border-radius: 24px;
        overflow: hidden;
      }
      .ho-truck-sep {
        border-top: 1px solid rgba(232,238,247,.06);
      }

      .ho-divider-row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 20px 0;
      }

      .ho-divider-line {
        flex: 1;
        height: 1px;
        background: rgba(232,238,247,.06);
      }

      /* ── Upload row ──────────────────────────── */
      .ho-row {
        padding: 16px 20px;
      }

      .ho-row-done {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 20px;
        opacity: .7;
      }

      .ho-row-check {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: rgba(41,255,176,.1);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--d-ok);
        flex-shrink: 0;
      }

      .ho-row-body { }

      .ho-row-top-info {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 14px;
      }

      .ho-row-icon {
        width: 32px;
        height: 32px;
        border-radius: 10px;
        background: var(--d-well);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--d-t2);
        flex-shrink: 0;
      }

      .ho-row-info {
        flex: 1;
        min-width: 0;
      }

      .ho-row-label {
        font-family: var(--d-font);
        font-size: 13px;
        font-weight: 600;
        color: var(--d-t1);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .ho-row-sub {
        font-family: var(--d-font-mono);
        font-size: 10px;
        color: var(--d-t2);
        margin-top: 2px;
      }

      /* ── Steps track ─────────────────────────── */
      .ho-steps-track {
        padding-left: 4px;
      }

      .ho-step {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        position: relative;
      }

      .ho-step-locked {
        opacity: .35;
        pointer-events: none;
      }

      .ho-step-complete .ho-step-indicator {
        background: rgba(41,255,176,.1);
        box-shadow: 0 0 0 1px rgba(41,255,176,.25);
        color: var(--d-ok);
      }

      .ho-step-indicator {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background: var(--d-well);
        box-shadow: 0 0 0 1px rgba(232,238,247,.1);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        margin-top: 1px;
      }

      .ho-step-num-text {
        font-family: var(--d-font-mono);
        font-size: 10px;
        font-weight: 700;
        color: var(--d-t2);
        line-height: 1;
      }

      .ho-step-connector {
        width: 1px;
        height: 12px;
        background: rgba(232,238,247,.1);
        margin: 2px 0 2px 12px;
      }

      .ho-step-content {
        flex: 1;
        min-width: 0;
        padding-bottom: 4px;
      }

      /* ── Action buttons ──────────────────────── */
      .ho-action-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 9px 16px;
        border-radius: 10px;
        font-family: var(--d-font);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all .15s;
        -webkit-tap-highlight-color: transparent;
      }
      .ho-action-btn:active { transform: scale(.96); }

      .ho-action-btn-outline {
        border: 1px dashed rgba(232,238,247,.14);
        background: var(--d-well);
        color: var(--d-sig);
      }
      .ho-action-btn-outline:hover {
        border-color: rgba(34,232,255,.3);
        background: rgba(34,232,255,.06);
      }

      .ho-action-btn-primary {
        border: none;
        background: var(--d-sig);
        color: var(--d-void);
      }
      .ho-action-btn-primary:hover:not(:disabled) {
        filter: brightness(1.1);
      }
      .ho-action-btn-primary:disabled {
        opacity: .5;
        cursor: default;
        transform: none;
      }

      /* ── Selfie preview ──────────────────────── */
      .ho-selfie-preview-wrap {
        position: relative;
        width: 60px;
        height: 60px;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 0 0 2px var(--d-ok);
      }

      .ho-selfie-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .ho-selfie-remove {
        position: absolute;
        top: 3px;
        right: 3px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: rgba(0,0,0,.65);
        border: none;
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
      }

      /* ── Row extras ──────────────────────────── */
      .ho-row-extras {
        margin-top: 8px;
        padding-left: 38px;
      }

      .ho-notes-toggle {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: none;
        border: none;
        color: var(--d-t3);
        font-family: var(--d-font-mono);
        font-size: 10px;
        cursor: pointer;
        padding: 4px 0;
      }
      .ho-notes-toggle:hover { color: var(--d-t2); }

      .ho-notes-input {
        display: block;
        width: 100%;
        margin-top: 6px;
        padding: 8px 12px;
        border-radius: 8px;
        border: none;
        box-shadow: 0 0 0 1px rgba(232,238,247,.08);
        background: var(--d-void);
        color: var(--d-t1);
        font-family: var(--d-font-mono);
        font-size: 11px;
        outline: none;
        transition: box-shadow .15s;
      }
      .ho-notes-input::placeholder { color: var(--d-t3); }
      .ho-notes-input:focus { box-shadow: 0 0 0 1px var(--d-sig3); }

      .ho-error {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
        padding: 8px 10px;
        border-radius: 8px;
        background: rgba(255,59,92,.06);
        box-shadow: 0 0 0 1px rgba(255,59,92,.15);
        font-family: var(--d-font-mono);
        font-size: 11px;
        color: var(--d-fire);
      }

      /* ── Complete state ──────────────────────── */
      .ho-complete-wrap {
        max-width: 520px;
        margin: 0 auto;
        padding: 80px 24px 40px;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        animation: ho-rise-in .4s ease both;
      }

      .ho-complete-btn {
        margin-top: 24px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 10px 20px;
        border-radius: 10px;
        border: none;
        box-shadow: 0 0 0 1px rgba(232,238,247,.1);
        background: var(--d-deep);
        color: var(--d-sig);
        font-family: var(--d-font);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all .15s;
      }
      .ho-complete-btn:hover {
        box-shadow: 0 0 0 1px rgba(232,238,247,.18);
        background: var(--d-well);
      }

      /* ── Skeleton loading ────────────────────── */
      .ho-skel-card {
        background: var(--d-deep);
        box-shadow: 0 0 0 1px rgba(232,238,247,.06);
        border-radius: 24px;
        padding: 16px 20px;
        margin-bottom: 8px;
      }

      .ho-skel-line {
        height: 12px;
        border-radius: 6px;
        background: linear-gradient(90deg, var(--d-well) 25%, var(--d-lift) 50%, var(--d-well) 75%);
        background-size: 200% 100%;
        animation: ho-shimmer 1.5s ease-in-out infinite;
      }

      .ho-skel-w60 { width: 60%; }
      .ho-skel-w40 { width: 40%; }

      .ho-skel-bar {
        height: 4px;
        border-radius: 999px;
        width: 100%;
        background: linear-gradient(90deg, var(--d-well) 25%, var(--d-lift) 50%, var(--d-well) 75%);
        background-size: 200% 100%;
        animation: ho-shimmer 1.5s ease-in-out infinite;
      }

      /* ── Animations ──────────────────────────── */
      @keyframes ho-shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      .ho-spin {
        animation: ho-spin-anim .8s linear infinite;
      }
      @keyframes ho-spin-anim {
        to { transform: rotate(360deg); }
      }

      .ho-sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0,0,0,0);
        white-space: nowrap;
        border: 0;
      }

      @media (prefers-reduced-motion: reduce) {
        .ho-spin, .ho-skel-line, .ho-skel-bar { animation: none; }
        .ho-stagger > * { animation: none; }
        .ho-detail, .ho-empty, .ho-complete-wrap { animation: none; }
      }
    `}</style>
  );
}
