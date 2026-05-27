import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { subscribe } from '../lib/centrifuge.js';
import { useAuthStore } from '../stores/auth.js';
import {
  FileBarChart, ChevronRight, ChevronLeft, RefreshCw,
  Download, AlertTriangle, CheckCircle, Clock, XCircle,
  Truck, Users, Archive, RotateCcw,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TruckSessionStatus {
  front: boolean;
  rear: boolean;
  seals: boolean[];
}

interface DailyReportTruck {
  convoy_truck_id: string;
  position: number;
  driver_name: string;
  vehicle_id: string | null;
  sod: TruckSessionStatus;
  eod: TruckSessionStatus;
  total_photos: number;
  required_photos: number;
}

interface DailyReport {
  id: string;
  report_date: string;
  status: string;
  required_photo_count: number;
  received_photo_count: number;
  pdf_url: string | null;
  generated_at: string | null;
  generation_error: string | null;
  location_mismatch_count: number;
  trucks: DailyReportTruck[];
}

interface ConvoyReportDetail {
  convoy: {
    id: string; name: string; status: string; timezone: string;
    start_date: string; end_date: string; seal_count_per_truck: number;
    archive_pdf_url: string | null; route_origin: string; route_destination: string;
  };
  trucks: Array<{ id: string; position: number; driver_name: string; vehicle_id: string | null }>;
  cfos: Array<{ cfo_user_id: string; cfo_name: string; cfo_email: string }>;
  daily_reports: DailyReport[];
}

interface LatestReport {
  report_date: string;
  status: string;
  required_photo_count: number;
  received_photo_count: number;
  pdf_url: string | null;
  generated_at: string | null;
  generation_error: string | null;
  location_mismatch_count: number;
}

interface ConvoyOverviewItem {
  id: string;
  name: string;
  status: string;
  timezone: string;
  start_date: string;
  end_date: string;
  seal_count_per_truck: number;
  archive_pdf_url: string | null;
  truck_count: number;
  cfo_count: number;
  latest_report: LatestReport | null;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

type StatusMeta = { bg: string; text: string; label: string; Icon: React.ElementType };

const STATUS_META: Record<string, StatusMeta> = {
  generated: { bg: 'bg-green-900/60',   text: 'text-green-300',   label: 'Generated', Icon: CheckCircle },
  complete:  { bg: 'bg-emerald-900/60', text: 'text-emerald-300', label: 'Complete',  Icon: CheckCircle },
  partial:   { bg: 'bg-amber-900/60',   text: 'text-amber-300',   label: 'Partial',   Icon: Clock },
  pending:   { bg: 'bg-slate-700',      text: 'text-slate-400',   label: 'Pending',   Icon: Clock },
  failed:    { bg: 'bg-red-900/60',     text: 'text-red-300',     label: 'Failed',    Icon: XCircle },
};

const FALLBACK_META: StatusMeta = STATUS_META['pending']!;

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? FALLBACK_META;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${m.bg} ${m.text}`}>
      <m.Icon size={10} />
      {m.label}
    </span>
  );
}

function ProgressBar({ received, required }: { received: number; required: number }) {
  const pct = required > 0 ? Math.min(100, Math.round((received / required) * 100)) : 0;
  const color = pct >= 100 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-slate-400 mb-1">
        <span>{received} / {required} photos</span>
        <span className={pct >= 100 ? 'text-green-400' : pct >= 50 ? 'text-amber-400' : 'text-red-400'}>
          {pct}%
        </span>
      </div>
      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function PhotoSlot({ present, label }: { present: boolean; label: string }) {
  return (
    <div
      title={label}
      className={`w-7 h-7 rounded text-xs font-bold flex items-center justify-center border ${
        present
          ? 'bg-green-900/60 border-green-600 text-green-300'
          : 'bg-red-900/60 border-red-700 text-red-400'
      }`}
    >
      {present ? '✓' : '✗'}
    </div>
  );
}

// ─── Per-truck photo matrix card ──────────────────────────────────────────────

function TruckPhotoMatrix({ truck }: { truck: DailyReportTruck }) {
  const pct = truck.required_photos > 0
    ? Math.round((truck.total_photos / truck.required_photos) * 100) : 0;

  return (
    <div className="bg-slate-800/60 rounded-lg p-3 border border-slate-700">
      <div className="flex items-center justify-between mb-2">
        <div className="min-w-0">
          <span className="text-xs font-bold text-slate-300">T{truck.position}</span>
          <span className="text-xs text-slate-400 ml-2 truncate">{truck.driver_name}</span>
          {truck.vehicle_id && (
            <span className="text-xs text-slate-500 ml-2">#{truck.vehicle_id.slice(-8)}</span>
          )}
        </div>
        <span className={`text-xs font-semibold shrink-0 ${pct >= 100 ? 'text-green-400' : 'text-amber-400'}`}>
          {truck.total_photos}/{truck.required_photos}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(['sod', 'eod'] as const).map(session => {
          const s = truck[session];
          const slots = [
            { label: 'Front', present: s.front },
            { label: 'Rear', present: s.rear },
            ...s.seals.map((present, i) => ({ label: `Seal ${i + 1}`, present })),
          ];
          return (
            <div key={session}>
              <p className="text-xs text-slate-500 font-medium mb-1 uppercase tracking-wide">{session}</p>
              <div className="flex flex-wrap gap-1">
                {slots.map((slot, i) => (
                  <PhotoSlot key={i} present={slot.present} label={slot.label} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Convoy detail drill-down view ────────────────────────────────────────────

function ConvoyDetailView({ convoyId, onBack }: { convoyId: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<ConvoyReportDetail>({
    queryKey: ['convoy-reports-detail', convoyId],
    queryFn: async () => {
      const res = await api.get<{ data: ConvoyReportDetail }>(`/convoys/${convoyId}/reports`);
      return res.data?.data ?? (res.data as unknown as ConvoyReportDetail);
    },
    refetchInterval: 30_000,
  });

  const regenerateMutation = useMutation({
    mutationFn: (date: string) => api.post(`/convoys/${convoyId}/reports/${date}/regenerate`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['convoy-reports-detail', convoyId] }),
  });

  if (isLoading) {
    return <div className="text-slate-400 text-sm py-12 text-center">Loading convoy reports…</div>;
  }
  if (isError || !data) {
    return <div className="text-red-400 text-sm py-12 text-center">Failed to load convoy reports.</div>;
  }

  const { convoy, daily_reports } = data;
  const sealCount = convoy.seal_count_per_truck ?? 3;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-slate-400 hover:text-orange-400 text-sm transition-colors"
        >
          <ChevronLeft size={16} /> Overview
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <FileBarChart size={18} className="text-orange-400 shrink-0" />
          <h2 className="text-lg font-bold truncate">{convoy.name}</h2>
          <span className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${
            convoy.status === 'active' ? 'bg-green-800 text-green-200' : 'bg-slate-700 text-slate-300'
          }`}>
            {convoy.status}
          </span>
        </div>
        {convoy.archive_pdf_url && (
          <a
            href={convoy.archive_pdf_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs font-medium text-slate-300 transition-colors"
          >
            <Archive size={14} /> Archive PDF
          </a>
        )}
      </div>

      {/* Convoy meta */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        {[
          { label: 'Route', value: `${convoy.route_origin} → ${convoy.route_destination}` },
          { label: 'Timezone', value: convoy.timezone },
          { label: 'Trucks', value: data.trucks.length },
          { label: 'CFOs', value: data.cfos.length },
        ].map(({ label, value }) => (
          <div key={label} className="bg-slate-800 rounded-lg p-3 border border-slate-700">
            <p className="text-slate-500 mb-0.5">{label}</p>
            <p className="font-semibold text-slate-200 truncate">{String(value)}</p>
          </div>
        ))}
      </div>

      {/* Daily reports */}
      {daily_reports.length === 0 ? (
        <div className="text-slate-500 text-sm text-center py-12 bg-slate-800 rounded-lg border border-slate-700">
          No daily reports yet for this convoy.
        </div>
      ) : (
        <div className="space-y-3">
          {daily_reports.map(report => {
            const isExpanded = expandedDate === report.report_date;
            const dateStr = String(report.report_date).slice(0, 10);
            return (
              <div key={report.id} className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedDate(isExpanded ? null : report.report_date)}
                  className="w-full flex items-center gap-3 p-4 hover:bg-slate-700/40 transition-colors text-left"
                >
                  <ChevronRight
                    size={16}
                    className={`text-slate-500 transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className="font-semibold text-sm">{dateStr}</span>
                      <StatusBadge status={report.status} />
                      {report.location_mismatch_count > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-amber-900/60 text-amber-300">
                          <AlertTriangle size={10} />
                          {report.location_mismatch_count} mismatch{report.location_mismatch_count !== 1 ? 'es' : ''}
                        </span>
                      )}
                    </div>
                    <div className="max-w-sm">
                      <ProgressBar
                        received={report.received_photo_count}
                        required={report.required_photo_count}
                      />
                    </div>
                    {report.generation_error && (
                      <p className="text-xs text-red-400 mt-1 truncate" title={report.generation_error}>
                        ⚠ {report.generation_error.slice(0, 80)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {report.pdf_url && (
                      <a
                        href={`/api/v1/convoys/${convoyId}/reports/${dateStr}/download`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="flex items-center gap-1 px-2 py-1 bg-orange-600 hover:bg-orange-700 rounded text-xs font-medium transition-colors"
                      >
                        <Download size={12} /> PDF
                      </a>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); regenerateMutation.mutate(dateStr); }}
                      disabled={regenerateMutation.isPending}
                      title="Regenerate PDF"
                      className="p-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-orange-400 transition-colors disabled:opacity-50"
                    >
                      <RotateCcw size={14} className={regenerateMutation.isPending ? 'animate-spin' : ''} />
                    </button>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-slate-700/60">
                    <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mt-3 mb-2">
                      Photo Matrix — {sealCount} seal{sealCount !== 1 ? 's' : ''}/truck
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                      {report.trucks.map(truck => (
                        <TruckPhotoMatrix key={truck.convoy_truck_id} truck={truck} />
                      ))}
                    </div>
                    {report.generated_at && (
                      <p className="text-xs text-slate-500 mt-3">
                        Generated: {new Date(report.generated_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Overview convoy card ─────────────────────────────────────────────────────

function ConvoyCard({ convoy, onSelect }: { convoy: ConvoyOverviewItem; onSelect: () => void }) {
  const report = convoy.latest_report;
  return (
    <button
      onClick={onSelect}
      className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-left hover:border-orange-500/40 hover:bg-slate-700/40 transition-all w-full"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm truncate">{convoy.name}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{convoy.timezone}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
            convoy.status === 'active'    ? 'bg-green-800 text-green-200'
            : convoy.status === 'planned' ? 'bg-blue-800 text-blue-200'
            : 'bg-slate-700 text-slate-300'
          }`}>
            {convoy.status}
          </span>
          <ChevronRight size={14} className="text-slate-500" />
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-slate-400 mb-3">
        <span className="flex items-center gap-1"><Truck size={11} /> {convoy.truck_count} trucks</span>
        <span className="flex items-center gap-1"><Users size={11} /> {convoy.cfo_count} CFOs</span>
      </div>

      {report ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <StatusBadge status={report.status} />
            <span className="text-xs text-slate-500">{String(report.report_date).slice(0, 10)}</span>
          </div>
          <ProgressBar received={report.received_photo_count} required={report.required_photo_count} />
          {report.location_mismatch_count > 0 && (
            <p className="text-xs text-amber-400 flex items-center gap-1">
              <AlertTriangle size={10} />
              {report.location_mismatch_count} location mismatch{report.location_mismatch_count !== 1 ? 'es' : ''}
            </p>
          )}
          {report.generation_error && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <XCircle size={10} /> Generation error
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-500">No reports yet</p>
      )}
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ConvoyReports() {
  const [selectedConvoyId, setSelectedConvoyId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const user = useAuthStore(s => s.user);

  const { data: overview, isLoading, isError, refetch } = useQuery<ConvoyOverviewItem[]>({
    queryKey: ['convoy-reports-overview'],
    queryFn: async () => {
      const res = await api.get<{ data: ConvoyOverviewItem[] }>('/convoys/reports/overview');
      return res.data?.data ?? [];
    },
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!user?.org_id) return;
    const unsub = subscribe<{ convoy_id: string; report_date: string; pdf_url: string | null }>(
      `convoy.report.ready.${user.org_id}`,
      (event) => {
        queryClient.invalidateQueries({ queryKey: ['convoy-reports-overview'] });
        queryClient.invalidateQueries({ queryKey: ['convoy-reports-detail', event.convoy_id] });
      }
    );
    return unsub;
  }, [user?.org_id, queryClient]);

  if (selectedConvoyId) {
    return (
      <ConvoyDetailView
        convoyId={selectedConvoyId}
        onBack={() => setSelectedConvoyId(null)}
      />
    );
  }

  const active = (overview ?? []).filter(c => c.status === 'active');
  const other  = (overview ?? []).filter(c => c.status !== 'active');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <FileBarChart size={20} className="text-orange-400" />
          <h1 className="text-xl font-bold">Convoy Reports</h1>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm text-slate-300 transition-colors"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {isError && <p className="text-red-400 text-sm">Failed to load convoy reports.</p>}

      {isLoading ? (
        <div className="text-slate-400 text-sm py-12 text-center">Loading…</div>
      ) : (overview ?? []).length === 0 ? (
        <div className="text-slate-500 text-sm py-12 text-center bg-slate-800 rounded-lg border border-slate-700">
          No convoys found. Create a convoy first to see report status here.
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Active Convoys ({active.length})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {active.map(c => (
                  <ConvoyCard key={c.id} convoy={c} onSelect={() => setSelectedConvoyId(c.id)} />
                ))}
              </div>
            </section>
          )}
          {other.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Other Convoys ({other.length})
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {other.map(c => (
                  <ConvoyCard key={c.id} convoy={c} onSelect={() => setSelectedConvoyId(c.id)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
