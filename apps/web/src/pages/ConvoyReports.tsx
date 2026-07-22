import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Loader2, AlertTriangle, ShieldCheck, TrendingUp, Truck, ArrowLeft,
  Folder, FolderOpen, ChevronRight, ChevronDown, FileText, CheckCircle2, Clock, CircleDashed,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { subscribe } from '../lib/centrifuge.js';
import { useAuthStore } from '../stores/auth.js';
import ReportDoc, { type ReportDetail } from '../components/reports/ReportDoc.js';

interface ConvoyOverviewItem {
  id: string;
  name: string;
  status: string;
  start_date: string;
  end_date: string;
  timezone: string;
  client_name?: string | null;
  client_company?: string | null;
  truck_count?: number;
  latest_report: {
    report_date: string;
    status: string;
    received_photo_count: number;
    required_photo_count: number;
    pdf_url?: string;
    location_mismatch_count: number;
  } | null;
}

interface ReportDay {
  report_date: string;
  status: string;
  required_photo_count: number;
  received_photo_count: number;
  pdf_url?: string | null;
  generated_at?: string | null;
  generation_error?: string | null;
  location_mismatch_count: number;
}
interface ReportDaysResponse {
  convoy: { id: string; name: string; status: string; start_date: string; end_date: string };
  days: ReportDay[];
}
// A calendar day in the drawer — either a real report row or a placeholder for
// a day the convoy ran but hasn't been generated yet.
interface MergedDay extends Partial<ReportDay> {
  report_date: string;
  status: string; // real status, or 'none' when no row exists yet
}

const ACTIVE_STATUSES = new Set(['planned', 'active', 'completing']);

const T = {
  bg: '#0b0f1a', panel: '#111827', panel2: '#1a2235', rim: '#1f2937',
  text: '#f1f5f9', body: '#cbd5e1', sub: '#6b7280', faint: '#4b5563',
  accent: '#d97706', mono: 'JetBrains Mono, monospace', syne: "'Syne', sans-serif",
  green: '#22c55e', amber: '#f59e0b', red: '#ef4444', blue: '#60a5fa',
};

const S = {
  root: { display: 'flex', height: '100%', background: T.bg, color: '#e2e8f0',
    fontFamily: "'Space Grotesk', sans-serif", overflow: 'hidden' } as React.CSSProperties,
  sidebar: { width: 340, minWidth: 300, display: 'flex', flexDirection: 'column' as const,
    background: T.panel, borderRight: `1px solid ${T.rim}`, overflow: 'hidden' } as React.CSSProperties,
  sidebarHeader: { padding: '20px 20px 16px', borderBottom: `1px solid ${T.rim}`, flexShrink: 0 } as React.CSSProperties,
  statsGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '14px 16px',
    borderBottom: `1px solid ${T.rim}`, flexShrink: 0 } as React.CSSProperties,
  statCard: (accent: string): React.CSSProperties => ({
    background: T.panel2, border: `1px solid ${accent}33`, borderRadius: 8, padding: '10px 12px' }),
  tree: { flex: 1, overflowY: 'auto' as const, padding: '8px 0' },
  viewer: { flex: 1, overflowY: 'auto' as const, background: T.bg, padding: '24px 32px' } as React.CSSProperties,
  emptyViewer: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexDirection: 'column' as const, gap: 12, color: '#374151' } as React.CSSProperties,
};

interface StatusMeta { label: string; color: string; Icon: typeof CheckCircle2 }
const NONE_META: StatusMeta = { label: 'No report', color: T.faint, Icon: CircleDashed };
const STATUS_META: Record<string, StatusMeta> = {
  generated: { label: 'Ready', color: T.green, Icon: CheckCircle2 },
  complete: { label: 'Complete', color: T.green, Icon: CheckCircle2 },
  partial: { label: 'Partial', color: T.amber, Icon: Clock },
  pending: { label: 'Pending', color: T.sub, Icon: Clock },
  failed: { label: 'Failed', color: T.red, Icon: AlertTriangle },
  none: NONE_META,
};

function isoRange(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const start = new Date(startISO + 'T00:00:00Z');
  const end = new Date(endISO + 'T00:00:00Z');
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return out;
  for (let d = new Date(start); d <= end && out.length < 120; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Merge the convoy's full operating calendar (start → min(end, today)) with the
// persisted report rows, so every day the convoy ran is listed — generatable on
// demand — and existing reports never disappear.
function buildDays(data: ReportDaysResponse | undefined): MergedDay[] {
  if (!data) return [];
  const byDate = new Map(data.days.map(d => [d.report_date, d]));
  const today = new Date().toISOString().slice(0, 10);
  const start = data.convoy.start_date ? String(data.convoy.start_date).slice(0, 10) : null;
  const endRaw = data.convoy.end_date ? String(data.convoy.end_date).slice(0, 10) : today;
  const end = endRaw < today ? endRaw : today;

  const dates = new Set<string>();
  if (start) isoRange(start, end).forEach(d => dates.add(d));
  data.days.forEach(d => dates.add(d.report_date)); // include any out-of-range persisted rows too

  return Array.from(dates)
    .sort((a, b) => (a < b ? 1 : -1)) // newest first
    .map(date => {
      const row = byDate.get(date);
      return row ? { ...row } : { report_date: date, status: 'none' };
    });
}

function DayRow({ day, selected, onClick }: { day: MergedDay; selected: boolean; onClick: () => void }) {
  const meta = STATUS_META[day.status] ?? NONE_META;
  const { Icon } = meta;
  const pct = day.required_photo_count && day.required_photo_count > 0
    ? Math.min(100, Math.round(((day.received_photo_count ?? 0) / day.required_photo_count) * 100)) : null;
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
        padding: '8px 12px 8px 40px', cursor: 'pointer',
        background: selected ? T.panel2 : 'transparent', border: 'none',
        borderLeft: `2px solid ${selected ? T.accent : 'transparent'}`,
      }}
    >
      <FileText size={13} color={selected ? T.accent : T.faint} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: T.mono, fontSize: 12, color: selected ? T.text : T.body }}>{day.report_date}</div>
        {pct != null && (
          <div style={{ fontFamily: T.mono, fontSize: 9, color: T.sub }}>
            {day.received_photo_count}/{day.required_photo_count} photos
            {day.location_mismatch_count ? ` · ${day.location_mismatch_count} GPS` : ''}
          </div>
        )}
      </div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <Icon size={11} color={meta.color} />
        <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
          color: meta.color, textTransform: 'uppercase' }}>{meta.label}</span>
      </span>
    </button>
  );
}

function ConvoyFolder({ convoy, expanded, onToggle, selectedId, selectedDate, onPickDay }: {
  convoy: ConvoyOverviewItem;
  expanded: boolean;
  onToggle: () => void;
  selectedId: string | null;
  selectedDate: string | null;
  onPickDay: (convoyId: string, date: string) => void;
}) {
  const { data: dayData, isLoading } = useQuery<ReportDaysResponse>({
    queryKey: ['convoy-report-days', convoy.id],
    queryFn: async () => (await api.get(`/convoys/${convoy.id}/report-days`)).data.data,
    enabled: expanded,
  });
  const days = useMemo(() => buildDays(dayData), [dayData]);
  const statusColor: Record<string, string> = {
    active: T.green, planned: T.amber, completing: T.blue, completed: T.blue, draft: T.sub, cancelled: T.red,
  };

  return (
    <div>
      <button
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
          padding: '9px 14px', cursor: 'pointer', background: 'transparent', border: 'none',
        }}
      >
        {expanded ? <ChevronDown size={13} color={T.sub} /> : <ChevronRight size={13} color={T.sub} />}
        {expanded ? <FolderOpen size={15} color={T.accent} /> : <Folder size={15} color={T.sub} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{convoy.name}</div>
          {convoy.client_name && (
            <div style={{ fontFamily: T.mono, fontSize: 9, color: T.accent }}>{convoy.client_name}</div>
          )}
        </div>
        <span style={{ fontFamily: T.mono, fontSize: 8, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: statusColor[convoy.status] || T.sub, flexShrink: 0 }}>
          {convoy.status}
        </span>
      </button>
      {expanded && (
        <div style={{ paddingBottom: 6 }}>
          {isLoading && (
            <div style={{ padding: '8px 40px', display: 'flex', alignItems: 'center', gap: 8, color: T.faint }}>
              <Loader2 size={12} className="animate-spin" />
              <span style={{ fontFamily: T.mono, fontSize: 10 }}>Loading days…</span>
            </div>
          )}
          {!isLoading && days.length === 0 && (
            <div style={{ padding: '8px 40px', fontFamily: T.mono, fontSize: 10, color: T.faint }}>
              No operating days recorded.
            </div>
          )}
          {days.map(day => (
            <DayRow
              key={day.report_date}
              day={day}
              selected={selectedId === convoy.id && selectedDate === day.report_date}
              onClick={() => onPickDay(convoy.id, day.report_date)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ConvoyReports(): React.ReactElement {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [expandedConvoy, setExpandedConvoy] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<{ active: boolean; completed: boolean }>({ active: true, completed: true });

  const { data: overview, isLoading: overviewLoading } = useQuery<{ data: ConvoyOverviewItem[] }>({
    queryKey: ['convoy-reports-overview'],
    queryFn: async () => (await api.get('/convoys/reports/overview')).data,
  });

  const { data: detail, isLoading: detailLoading, isError: detailError } = useQuery<{ data: ReportDetail }>({
    queryKey: ['convoy-report-detail', selectedId, selectedDate],
    queryFn: async () => (await api.get(`/convoys/${selectedId}/reports/${selectedDate}/detail`)).data,
    enabled: !!(selectedId && selectedDate),
    refetchInterval: (query) => {
      const status = query.state.data?.data.daily_report?.status;
      return status === 'partial' || status === 'pending' ? 3000 : false;
    },
  });

  // Report-ready realtime → refresh the open convoy's day list, the overview,
  // and the current detail so a freshly generated PDF surfaces without reload.
  useEffect(() => {
    if (!user?.org_id) return;
    const unsub = subscribe<{ convoy_id: string; report_date: string; pdf_url: string }>(
      `convoy.report.ready.${user.org_id}`,
      () => {
        void queryClient.invalidateQueries({ queryKey: ['convoy-reports-overview'] });
        void queryClient.invalidateQueries({ queryKey: ['convoy-report-days'] });
        void queryClient.invalidateQueries({ queryKey: ['convoy-report-detail'] });
      }
    );
    return unsub;
  }, [user?.org_id, queryClient]);

  const regenerateMutation = useMutation({
    mutationFn: async () => { await api.post(`/convoys/${selectedId}/reports/${selectedDate}/regenerate`); },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['convoy-report-detail', selectedId, selectedDate] });
      void queryClient.invalidateQueries({ queryKey: ['convoy-report-days', selectedId] });
      void queryClient.invalidateQueries({ queryKey: ['convoy-reports-overview'] });
    },
    onError: (err: any) => {
      alert(err?.response?.data?.error || err?.message || 'Could not regenerate the report. Please try again.');
    },
  });

  const items = overview?.data ?? [];
  const active = items.filter(c => ACTIVE_STATUSES.has(c.status));
  const completed = items.filter(c => !ACTIVE_STATUSES.has(c.status));

  const stats = {
    total: items.length,
    active: active.length,
    completed: completed.length,
    mismatches: items.reduce((a, c) => a + (c.latest_report?.location_mismatch_count ?? 0), 0),
  };

  function pickDay(convoyId: string, date: string) {
    setSelectedId(convoyId);
    setSelectedDate(date);
  }
  function toggleConvoy(id: string) {
    setExpandedConvoy(prev => (prev === id ? null : id));
  }

  const renderGroup = (label: string, key: 'active' | 'completed', convoys: ConvoyOverviewItem[], accent: string) => (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={() => setOpenGroups(g => ({ ...g, [key]: !g[key] }))}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
          padding: '10px 14px', cursor: 'pointer', background: 'transparent', border: 'none' }}
      >
        {openGroups[key] ? <ChevronDown size={13} color={accent} /> : <ChevronRight size={13} color={accent} />}
        <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: accent }}>{label}</span>
        <span style={{ marginLeft: 'auto', fontFamily: T.mono, fontSize: 10, color: T.sub,
          background: T.panel2, borderRadius: 99, padding: '1px 8px' }}>{convoys.length}</span>
      </button>
      {openGroups[key] && (
        convoys.length === 0
          ? <div style={{ padding: '4px 14px 8px 34px', fontFamily: T.mono, fontSize: 10, color: T.faint }}>None</div>
          : convoys.map(c => (
            <ConvoyFolder
              key={c.id}
              convoy={c}
              expanded={expandedConvoy === c.id}
              onToggle={() => toggleConvoy(c.id)}
              selectedId={selectedId}
              selectedDate={selectedDate}
              onPickDay={pickDay}
            />
          ))
      )}
    </div>
  );

  return (
    <div style={S.root}>
      <aside style={S.sidebar}>
        <div style={S.sidebarHeader}>
          <button
            onClick={() => void navigate({ to: '/convoys' })}
            style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none',
              color: T.faint, cursor: 'pointer', padding: 0, marginBottom: 10, fontSize: 11, fontFamily: T.mono }}>
            <ArrowLeft size={11} /> Fleet Ops
          </button>
          <div style={{ fontFamily: T.syne, fontWeight: 800, fontSize: 16, color: T.text, letterSpacing: '-0.01em' }}>
            Convoy Intelligence
          </div>
          <div style={{ fontSize: 11, color: T.faint, marginTop: 2, fontFamily: T.mono }}>
            Report Archive · every day, retained
          </div>
        </div>

        <div style={S.statsGrid}>
          {[
            { label: 'Convoys', value: stats.total, icon: <Truck size={12} />, accent: T.blue },
            { label: 'Active', value: stats.active, icon: <ShieldCheck size={12} />, accent: T.green },
            { label: 'Completed', value: stats.completed, icon: <TrendingUp size={12} />, accent: T.accent },
            { label: 'GPS Flags', value: stats.mismatches, icon: <AlertTriangle size={12} />, accent: T.red },
          ].map(({ label, value, icon, accent }) => (
            <div key={label} style={S.statCard(accent)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4, color: accent }}>
                {icon}
                <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em',
                  textTransform: 'uppercase', fontFamily: T.mono }}>{label}</span>
              </div>
              <div style={{ fontFamily: T.syne, fontWeight: 700, fontSize: 22, color: T.text }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={S.tree}>
          {overviewLoading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
              <Loader2 size={18} className="animate-spin" style={{ color: T.faint }} />
            </div>
          )}
          {!overviewLoading && items.length === 0 && (
            <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 12, color: T.faint }}>
              No convoys found.
            </div>
          )}
          {!overviewLoading && items.length > 0 && (
            <>
              {renderGroup('Active convoys', 'active', active, T.green)}
              {renderGroup('Completed convoys', 'completed', completed, T.blue)}
            </>
          )}
        </div>
      </aside>

      <main style={S.viewer}>
        {!selectedId && (
          <div style={{ ...S.emptyViewer, height: '100%' }}>
            <FolderOpen size={40} style={{ opacity: 0.2 }} />
            <span style={{ fontSize: 14 }}>Open a convoy folder and pick a day to view its report</span>
          </div>
        )}
        {selectedId && detailLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh', gap: 10, color: T.faint }}>
            <Loader2 size={20} className="animate-spin" />
            <span style={{ fontSize: 13 }}>Loading report…</span>
          </div>
        )}
        {selectedId && selectedDate && detailError && !detailLoading && (
          <div style={{ ...S.emptyViewer, height: '40vh', color: T.red, gap: 8 }}>
            <AlertTriangle size={28} style={{ opacity: 0.7 }} />
            <span style={{ fontSize: 13 }}>Failed to load report. Try again or check server logs.</span>
          </div>
        )}
        {detail?.data && !detailLoading && (
          <ReportDoc
            detail={detail.data}
            onRegenerate={() => regenerateMutation.mutate()}
            regenerating={regenerateMutation.isPending}
          />
        )}
      </main>
    </div>
  );
}
