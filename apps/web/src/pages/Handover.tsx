import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Truck, FileCheck2, Loader2, AlertCircle, CheckCircle2,
  ChevronRight, MapPin, ArrowRight, Package, Camera, FileText,
  RefreshCw, ClipboardCheck,
} from 'lucide-react';
import { api } from '../lib/api.js';

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
  notes: string | null;
  signed_off_at: string;
}

interface HandoverDetail {
  convoy: { id: string; name: string; region: string; route_origin: string; route_destination: string; status: string };
  trucks: HandoverTruck[];
  handovers: HandoverRecord[];
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
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = useMutation({
    mutationFn: async (file: File) => {
      const content_type = file.type === 'application/pdf' ? 'application/pdf' : 'image/jpeg';
      const { data: presign } = await api.post<{ upload_url: string; public_url: string; key: string }>(
        `/convoy-handovers/${convoyId}/upload-url`,
        { truck_id: truckId, content_type },
      );
      const put = await fetch(presign.upload_url, { method: 'PUT', body: file, headers: { 'Content-Type': content_type } });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      await api.post(`/convoy-handovers/${convoyId}/commit`, {
        truck_id: truckId, form_key: presign.key, form_url: presign.public_url,
        notes: notes || undefined,
      });
    },
    onSuccess: () => { setNotes(''); setShowNotes(false); onDone(); },
    onError: (err: Error) => setError(err.message || 'Upload failed'),
  });

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) { setError(null); submit.mutate(file); }
  };

  if (alreadyDone) {
    return (
      <div className="ho-row ho-row-done">
        <div className="ho-row-check"><CheckCircle2 size={18} /></div>
        <div className="ho-row-info">
          <div className="ho-row-label">{label}</div>
          {subtitle && <div className="ho-row-sub">{subtitle}</div>}
        </div>
        <span className="ho-badge ho-badge-done">Done</span>
      </div>
    );
  }

  return (
    <div className="ho-row">
      <div className="ho-row-icon"><Truck size={16} /></div>
      <div className="ho-row-body">
        <div className="ho-row-top">
          <div className="ho-row-info">
            <div className="ho-row-label">{label}</div>
            {subtitle && <div className="ho-row-sub">{subtitle}</div>}
          </div>
          <button
            className="ho-upload-btn"
            disabled={submit.isPending}
            onClick={() => fileRef.current?.click()}
          >
            {submit.isPending
              ? <><Loader2 size={14} className="ho-spin" /> Uploading</>
              : <><Camera size={14} /> Upload</>}
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,application/pdf" className="ho-sr-only" onChange={onFile} disabled={submit.isPending} />
        </div>
        <button className="ho-notes-toggle" onClick={() => setShowNotes(!showNotes)}>
          <FileText size={12} /> {showNotes ? 'Hide notes' : 'Add notes'}
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
            <AlertCircle size={13} /> {error}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Convoy detail — selected convoy's trucks ───────────────────────── */

function ConvoyDetail({ convoyId, onBack }: { convoyId: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['convoy-handover-detail', convoyId],
    queryFn: async () => (await api.get<{ data: HandoverDetail }>(`/convoy-handovers/${convoyId}`)).data.data,
    refetchInterval: 5000,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['convoy-handover-detail', convoyId] });
    void queryClient.invalidateQueries({ queryKey: ['convoy-handover-queue'] });
  };

  if (isLoading || !data) {
    return (
      <div className="ho-loading">
        <Loader2 size={22} className="ho-spin" />
        <span>Loading convoy…</span>
      </div>
    );
  }

  if (data.convoy.status !== 'completing') {
    return (
      <div className="ho-complete-card">
        <div className="ho-complete-icon"><CheckCircle2 size={32} /></div>
        <div className="ho-complete-title">{data.convoy.name}</div>
        <div className="ho-complete-sub">All trucks have been handed over successfully.</div>
        <button className="ho-back-btn" onClick={onBack}>Back to queue</button>
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
        <ChevronRight size={16} className="ho-flip" /> Back
      </button>

      <div className="ho-detail-header">
        <div className="ho-detail-name">{data.convoy.name}</div>
        <div className="ho-detail-route">
          <MapPin size={12} /> {data.convoy.route_origin}
          <ArrowRight size={12} />
          {data.convoy.route_destination}
        </div>
        <div className="ho-progress">
          <div className="ho-progress-bar">
            <div className="ho-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="ho-progress-label">{doneCount}/{data.trucks.length} trucks</span>
        </div>
      </div>

      <div className="ho-section-label">
        <ClipboardCheck size={13} /> Whole convoy handover
      </div>
      <div className="ho-card">
        <UploadRow
          convoyId={convoyId}
          truckId={null}
          label="Complete convoy"
          subtitle="Upload one form covering all trucks"
          alreadyDone={!!convoyWide}
          onDone={refresh}
        />
      </div>

      {!convoyWide && data.trucks.length > 0 && (
        <>
          <div className="ho-divider-row">
            <div className="ho-divider-line" />
            <span className="ho-divider-text">or truck by truck</span>
            <div className="ho-divider-line" />
          </div>
          <div className="ho-card ho-truck-list">
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

/* ── Queue list — the main page ─────────────────────────────────────── */

export default function Handover() {
  const [selected, setSelected] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: queue, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['convoy-handover-queue'],
    queryFn: async () => (await api.get<{ data: HandoverQueueItem[] }>('/convoy-handovers/queue')).data.data,
    refetchInterval: 10000,
  });

  const manualRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['convoy-handover-queue'] });
  }, [queryClient]);

  if (selected) {
    return (
      <div className="ho-page">
        <ConvoyDetail convoyId={selected} onBack={() => setSelected(null)} />
        <HandoverStyles />
      </div>
    );
  }

  return (
    <div className="ho-page">
      <div className="ho-queue">
        {/* Header */}
        <div className="ho-q-header">
          <div className="ho-q-icon"><FileCheck2 size={20} /></div>
          <div>
            <h1 className="ho-q-title">Handover Queue</h1>
            <p className="ho-q-sub">Convoys awaiting signed handover forms</p>
          </div>
          <button className="ho-refresh" onClick={manualRefresh} aria-label="Refresh">
            <RefreshCw size={16} />
          </button>
        </div>

        {/* Count badge */}
        {queue && queue.length > 0 && (
          <div className="ho-q-count">
            <Package size={13} />
            <span>{queue.length} convoy{queue.length !== 1 ? 's' : ''} pending</span>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="ho-loading">
            <Loader2 size={22} className="ho-spin" />
            <span>Loading queue…</span>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && queue?.length === 0 && (
          <div className="ho-empty">
            <div className="ho-empty-ring">
              <CheckCircle2 size={36} />
            </div>
            <div className="ho-empty-title">All clear</div>
            <div className="ho-empty-sub">No convoys awaiting handover right now.<br />Queue refreshes automatically.</div>
            {dataUpdatedAt > 0 && (
              <div className="ho-empty-ts">
                Last checked {new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>
        )}

        {/* Queue cards */}
        {!isLoading && queue && queue.length > 0 && (
          <div className="ho-q-list">
            {queue.map((c) => {
              const pct = c.truck_count > 0 ? Math.round((c.trucks_handed_over / c.truck_count) * 100) : 0;
              return (
                <button key={c.id} className="ho-q-card" onClick={() => setSelected(c.id)}>
                  <div className="ho-q-card-top">
                    <div className="ho-q-card-name">{c.name}</div>
                    <ChevronRight size={16} className="ho-q-card-arrow" />
                  </div>
                  <div className="ho-q-card-route">
                    <MapPin size={11} /> {c.route_origin} <ArrowRight size={10} /> {c.route_destination}
                  </div>
                  <div className="ho-q-card-stats">
                    <div className="ho-q-card-trucks">
                      <Truck size={13} />
                      <span>{c.trucks_handed_over}/{c.truck_count} trucks</span>
                      {c.convoy_wide_handover && <span className="ho-badge ho-badge-done">Complete</span>}
                    </div>
                    <div className="ho-q-progress-mini">
                      <div className="ho-q-progress-fill-mini" style={{ width: `${pct}%` }} />
                    </div>
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
      .ho-page {
        min-height: 100%;
        background: var(--d-void);
        padding: 0 0 env(safe-area-inset-bottom, 0);
      }

      /* ── Queue ───────────────────────────────── */
      .ho-queue { max-width: 520px; margin: 0 auto; padding: 20px 16px 40px; }
      .ho-q-header {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        margin-bottom: 20px;
      }
      .ho-q-icon {
        width: 40px; height: 40px;
        border-radius: 10px;
        background: linear-gradient(135deg, var(--d-orange), var(--d-sig));
        display: flex; align-items: center; justify-content: center;
        color: #fff;
        flex-shrink: 0;
      }
      .ho-q-title {
        font-family: var(--d-font);
        font-size: 18px;
        font-weight: 700;
        color: var(--d-t1);
        margin: 0;
        line-height: 1.2;
      }
      .ho-q-sub {
        font-family: var(--d-font-mono);
        font-size: 11px;
        color: var(--d-t2);
        margin: 3px 0 0;
      }
      .ho-refresh {
        margin-left: auto;
        flex-shrink: 0;
        width: 36px; height: 36px;
        border-radius: 8px;
        border: 1px solid var(--d-rim2);
        background: none;
        color: var(--d-t2);
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: all .15s;
      }
      .ho-refresh:hover { color: var(--d-sig); border-color: var(--d-rim3); }
      .ho-refresh:active { transform: rotate(90deg); }

      .ho-q-count {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 12px;
        border-radius: 20px;
        background: var(--d-sg2);
        border: 1px solid var(--d-sg);
        color: var(--d-sig);
        font-family: var(--d-font-mono);
        font-size: 11px;
        font-weight: 600;
        margin-bottom: 16px;
      }

      /* ── Queue cards ─────────────────────────── */
      .ho-q-list { display: flex; flex-direction: column; gap: 10px; }
      .ho-q-card {
        display: block;
        width: 100%;
        text-align: left;
        background: var(--d-deep);
        border: 1px solid var(--d-rim);
        border-radius: 12px;
        padding: 14px 16px;
        cursor: pointer;
        transition: all .2s;
        -webkit-tap-highlight-color: transparent;
      }
      .ho-q-card:hover { border-color: var(--d-rim2); background: var(--d-well); }
      .ho-q-card:active { transform: scale(.985); }
      .ho-q-card-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .ho-q-card-name {
        font-family: var(--d-font);
        font-size: 14px;
        font-weight: 600;
        color: var(--d-t1);
      }
      .ho-q-card-arrow {
        color: var(--d-t3);
        flex-shrink: 0;
        transition: transform .2s;
      }
      .ho-q-card:hover .ho-q-card-arrow { transform: translateX(2px); color: var(--d-sig); }
      .ho-q-card-route {
        display: flex;
        align-items: center;
        gap: 5px;
        font-family: var(--d-font-mono);
        font-size: 10px;
        color: var(--d-t2);
        margin-top: 6px;
      }
      .ho-q-card-stats {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 10px;
      }
      .ho-q-card-trucks {
        display: flex;
        align-items: center;
        gap: 5px;
        font-family: var(--d-font-mono);
        font-size: 11px;
        color: var(--d-t2);
        flex-shrink: 0;
      }
      .ho-q-progress-mini {
        flex: 1;
        height: 4px;
        border-radius: 2px;
        background: var(--d-rim);
        overflow: hidden;
      }
      .ho-q-progress-fill-mini {
        height: 100%;
        border-radius: 2px;
        background: linear-gradient(90deg, var(--d-sig), var(--d-ok));
        transition: width .4s ease;
      }

      /* ── Empty state ─────────────────────────── */
      .ho-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: 56px 24px 24px;
      }
      .ho-empty-ring {
        width: 72px; height: 72px;
        border-radius: 50%;
        background: var(--d-sg2);
        border: 2px solid var(--d-sg);
        display: flex; align-items: center; justify-content: center;
        color: var(--d-sig);
        margin-bottom: 20px;
      }
      .ho-empty-title {
        font-family: var(--d-font);
        font-size: 17px;
        font-weight: 700;
        color: var(--d-t1);
        margin-bottom: 8px;
      }
      .ho-empty-sub {
        font-family: var(--d-font-mono);
        font-size: 12px;
        color: var(--d-t2);
        line-height: 1.6;
      }
      .ho-empty-ts {
        margin-top: 16px;
        font-family: var(--d-font-mono);
        font-size: 10px;
        color: var(--d-t3);
      }

      /* ── Loading ─────────────────────────────── */
      .ho-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        padding: 56px 24px;
        font-family: var(--d-font-mono);
        font-size: 12px;
        color: var(--d-t2);
      }

      /* ── Detail view ─────────────────────────── */
      .ho-detail { max-width: 520px; margin: 0 auto; padding: 16px 16px 40px; }
      .ho-detail-back {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: none;
        border: none;
        color: var(--d-sig);
        font-family: var(--d-font-mono);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        padding: 4px 0;
        margin-bottom: 16px;
      }
      .ho-detail-back:hover { text-decoration: underline; }
      .ho-flip { transform: rotate(180deg); }

      .ho-detail-header {
        background: var(--d-deep);
        border: 1px solid var(--d-rim);
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 20px;
      }
      .ho-detail-name {
        font-family: var(--d-font);
        font-size: 16px;
        font-weight: 700;
        color: var(--d-t1);
      }
      .ho-detail-route {
        display: flex;
        align-items: center;
        gap: 5px;
        font-family: var(--d-font-mono);
        font-size: 11px;
        color: var(--d-t2);
        margin-top: 6px;
      }
      .ho-progress { margin-top: 14px; display: flex; align-items: center; gap: 10px; }
      .ho-progress-bar {
        flex: 1;
        height: 6px;
        border-radius: 3px;
        background: var(--d-rim);
        overflow: hidden;
      }
      .ho-progress-fill {
        height: 100%;
        border-radius: 3px;
        background: linear-gradient(90deg, var(--d-sig), var(--d-ok));
        transition: width .4s ease;
      }
      .ho-progress-label {
        font-family: var(--d-font-mono);
        font-size: 11px;
        color: var(--d-t2);
        flex-shrink: 0;
      }

      .ho-section-label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-family: var(--d-font-mono);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: .08em;
        text-transform: uppercase;
        color: var(--d-t2);
        margin-bottom: 8px;
      }

      .ho-card {
        background: var(--d-deep);
        border: 1px solid var(--d-rim);
        border-radius: 12px;
        overflow: hidden;
      }
      .ho-truck-list .ho-truck-sep { border-top: 1px solid var(--d-rim); }

      .ho-divider-row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 20px 0;
      }
      .ho-divider-line { flex: 1; height: 1px; background: var(--d-rim); }
      .ho-divider-text {
        font-family: var(--d-font-mono);
        font-size: 10px;
        color: var(--d-t3);
        text-transform: uppercase;
        letter-spacing: .06em;
        flex-shrink: 0;
      }

      /* ── Upload row ──────────────────────────── */
      .ho-row {
        display: flex;
        gap: 12px;
        padding: 14px 16px;
        align-items: flex-start;
      }
      .ho-row-done { opacity: .7; }
      .ho-row-icon {
        width: 32px; height: 32px;
        border-radius: 8px;
        background: var(--d-well);
        display: flex; align-items: center; justify-content: center;
        color: var(--d-t2);
        flex-shrink: 0;
        margin-top: 2px;
      }
      .ho-row-check {
        width: 32px; height: 32px;
        border-radius: 8px;
        background: rgba(41,255,176,.1);
        display: flex; align-items: center; justify-content: center;
        color: var(--d-ok);
        flex-shrink: 0;
        margin-top: 2px;
      }
      .ho-row-body { flex: 1; min-width: 0; }
      .ho-row-top { display: flex; align-items: center; gap: 10px; }
      .ho-row-info { flex: 1; min-width: 0; }
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

      .ho-upload-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 14px;
        border-radius: 8px;
        border: none;
        background: linear-gradient(135deg, var(--d-orange), var(--d-sig));
        color: #fff;
        font-family: var(--d-font);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        flex-shrink: 0;
        transition: all .15s;
        -webkit-tap-highlight-color: transparent;
      }
      .ho-upload-btn:hover { filter: brightness(1.1); }
      .ho-upload-btn:active { transform: scale(.96); }
      .ho-upload-btn:disabled { opacity: .6; cursor: default; }

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
        margin-top: 6px;
      }
      .ho-notes-toggle:hover { color: var(--d-t2); }

      .ho-notes-input {
        display: block;
        width: 100%;
        margin-top: 6px;
        padding: 8px 10px;
        border-radius: 6px;
        border: 1px solid var(--d-rim2);
        background: var(--d-void);
        color: var(--d-t1);
        font-family: var(--d-font-mono);
        font-size: 11px;
        outline: none;
        transition: border-color .15s;
      }
      .ho-notes-input::placeholder { color: var(--d-t3); }
      .ho-notes-input:focus { border-color: var(--d-sig3); }

      .ho-error {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 6px;
        font-family: var(--d-font-mono);
        font-size: 11px;
        color: var(--d-fire);
      }

      .ho-badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 10px;
        font-family: var(--d-font-mono);
        font-size: 10px;
        font-weight: 600;
        flex-shrink: 0;
      }
      .ho-badge-done {
        background: rgba(41,255,176,.12);
        color: var(--d-ok);
      }

      /* ── Complete card ───────────────────────── */
      .ho-complete-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        padding: 56px 24px;
        max-width: 520px;
        margin: 0 auto;
      }
      .ho-complete-icon {
        width: 64px; height: 64px;
        border-radius: 50%;
        background: rgba(41,255,176,.12);
        border: 2px solid rgba(41,255,176,.3);
        display: flex; align-items: center; justify-content: center;
        color: var(--d-ok);
        margin-bottom: 16px;
      }
      .ho-complete-title {
        font-family: var(--d-font);
        font-size: 17px;
        font-weight: 700;
        color: var(--d-t1);
        margin-bottom: 6px;
      }
      .ho-complete-sub {
        font-family: var(--d-font-mono);
        font-size: 12px;
        color: var(--d-t2);
      }
      .ho-back-btn {
        margin-top: 20px;
        padding: 10px 20px;
        border-radius: 8px;
        border: 1px solid var(--d-rim2);
        background: none;
        color: var(--d-sig);
        font-family: var(--d-font);
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all .15s;
      }
      .ho-back-btn:hover { border-color: var(--d-sig3); background: var(--d-sg2); }

      /* ── Utilities ───────────────────────────── */
      .ho-spin { animation: ho-spin .8s linear infinite; }
      @keyframes ho-spin { to { transform: rotate(360deg); } }
      .ho-sr-only {
        position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
        overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
      }
    `}</style>
  );
}
