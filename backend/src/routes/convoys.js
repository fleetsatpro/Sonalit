import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Loader2, AlertTriangle, ShieldCheck, TrendingUp, Truck, ArrowLeft } from 'lucide-react';
import { api } from '../lib/api.js';
import ReportDoc, { type ReportDetail } from '../components/reports/ReportDoc.js';

interface ConvoyOverviewItem {
  id: string;
  name: string;
  status: string;
  start_date: string;
  end_date: string;
  timezone: string;
  latest_report: {
    report_date: string;
    status: string;
    received_photo_count: number;
    required_photo_count: number;
    pdf_url?: string;
    location_mismatch_count: number;
  } | null;
}

type FilterTab = 'all' | 'active' | 'completed' | 'pending';

const S = {
  root: {
    display: 'flex', height: '100%', background: '#0b0f1a', color: '#e2e8f0',
    fontFamily: "'Space Grotesk', sans-serif", overflow: 'hidden',
  } as React.CSSProperties,
  sidebar: {
    width: 320, minWidth: 280, display: 'flex', flexDirection: 'column' as const,
    background: '#111827', borderRight: '1px solid #1f2937', overflow: 'hidden',
  } as React.CSSProperties,
  sidebarHeader: {
    padding: '20px 20px 16px', borderBottom: '1px solid #1f2937', flexShrink: 0,
  } as React.CSSProperties,
  statsGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '14px 16px',
    borderBottom: '1px solid #1f2937', flexShrink: 0,
  } as React.CSSProperties,
  statCard: (accent: string): React.CSSProperties => ({
    background: '#1a2235', border: `1px solid ${accent}33`, borderRadius: 8,
    padding: '10px 12px',
  }),
  tabs: {
    display: 'flex', gap: 4, padding: '10px 16px', borderBottom: '1px solid #1f2937', flexShrink: 0,
  } as React.CSSProperties,
  tab: (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '5px 4px', borderRadius: 6, border: 'none',
    background: active ? '#d97706' : 'transparent',
    color: active ? '#fff' : '#6b7280', cursor: 'pointer',
    fontSize: 11, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif",
    letterSpacing: '0.02em',
  }),
  convoyList: {
    flex: 1, overflowY: 'auto' as const, padding: '8px 0',
  },
  convoyCard: (selected: boolean): React.CSSProperties => ({
    padding: '12px 16px', cursor: 'pointer', borderLeft: `3px solid ${selected ? '#d97706' : 'transparent'}`,
    background: selected ? '#1a2235' : 'transparent', transition: 'all 0.15s',
  }),
  viewer: {
    flex: 1, overflowY: 'auto' as const, background: '#0b0f1a', padding: '24px 32px',
  } as React.CSSProperties,
  emptyViewer: {
    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexDirection: 'column' as const, gap: 12, color: '#374151',
  } as React.CSSProperties,
};

function ConvoyCard({ item, selected, onClick }: {
  item: ConvoyOverviewItem;
  selected: boolean;
  onClick: () => void;
}) {
  const lr = item.latest_report;
  const pct = lr && lr.required_photo_count > 0
    ? Math.round((lr.received_photo_count / lr.required_photo_count) * 100)
    : null;

  const statusColor: Record<string, string> = {
    active: '#22c55e', planned: '#f59e0b', completed: '#60a5fa',
    draft: '#6b7280', cancelled: '#ef4444',
  };

  return (
    <div style={S.convoyCard(selected)} onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: '#f1f5f9' }}>{item.name}</span>
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: statusColor[item.status] || '#6b7280', fontFamily: 'JetBrains Mono, monospace',
        }}>{item.status}</span>
      </div>
      {lr && (
        <>
          <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 6, fontFamily: 'JetBrains Mono, monospace' }}>
            {lr.report_date} · {lr.received_photo_count}/{lr.required_photo_count} photos
          </div>
          <div style={{ height: 3, background: '#1f2937', borderRadius: 99 }}>
            <div style={{
              height: '100%', width: `${pct ?? 0}%`, borderRadius: 99,
              background: (pct ?? 0) >= 100 ? '#22c55e' : (pct ?? 0) >= 50 ? '#f59e0b' : '#ef4444',
            }} />
          </div>
          {lr.location_mismatch_count > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}>
              <AlertTriangle size={10} color="#f59e0b" />
              <span style={{ fontSize: 9, color: '#f59e0b', fontFamily: 'JetBrains Mono, monospace' }}>
                {lr.location_mismatch_count} GPS mismatch
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function toLocalDateString(raw: string, fallbackYear: number): string | null {
  // Already YYYY-MM-DD — use as-is
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // Parse "Thu Jun 11" style using local date parts to avoid UTC shift
  const parsed = new Date(`${raw} ${fallbackYear}`);
  if (isNaN(parsed.getTime())) return null;

  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function ConvoyReports(): React.ReactElement {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>('all');

  const { data: overview, isLoading: overviewLoading } = useQuery<{ data: ConvoyOverviewItem[] }>({
    queryKey: ['convoy-reports-overview'],
    queryFn: async () => (await api.get('/convoys/reports/overview')).data,
  });

  const { data: detail, isLoading: detailLoading, isError: detailError } = useQuery<{ data: ReportDetail }>({
    queryKey: ['convoy-report-detail', selectedId, selectedDate],
    queryFn: async () => (await api.get(`/convoys/${selectedId}/reports/${selectedDate}/detail`)).data,
    enabled: !!(selectedId && selectedDate),
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/convoys/${selectedId}/reports/${selectedDate}/regenerate`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['convoy-report-detail', selectedId, selectedDate] });
      void queryClient.invalidateQueries({ queryKey: ['convoy-reports-overview'] });
    },
  });

  const items = overview?.data ?? [];
  const filtered = filter === 'all' ? items : items.filter(c => {
    if (filter === 'active') return c.status === 'active';
    if (filter === 'completed') return c.status === 'completed';
    if (filter === 'pending') return !c.latest_report || c.latest_report.status === 'pending';
    return true;
  });

  const stats = {
    total: items.length,
    active: items.filter(c => c.status === 'active').length,
    mismatches: items.reduce((a, c) => a + (c.latest_report?.location_mismatch_count ?? 0), 0),
    complete: items.filter(c =>
      c.latest_report?.status === 'complete' || c.latest_report?.status === 'generated'
    ).length,
  };

  function handleSelectConvoy(item: ConvoyOverviewItem) {
    setSelectedId(item.id);
    const raw: string | null = item.latest_report ? item.latest_report.report_date : null;
    if (!raw) { setSelectedDate(null); return; }

    const fallbackYear = item.start_date
      ? new Date(item.start_date).getFullYear()
      : new Date().getFullYear();

    setSelectedDate(toLocalDateString(raw, fallbackYear));
  }

  return (
    <div style={S.root}>
      <aside style={S.sidebar}>
        <div style={S.sidebarHeader}>
          <button
            onClick={() => void navigate({ to: '/convoys' })}
            style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none',
              color: '#4b5563', cursor: 'pointer', padding: 0, marginBottom: 10, fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace" }}>
            <ArrowLeft size={11} /> Fleet Ops
          </button>
          <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 16, color: '#f1f5f9',
            letterSpacing: '-0.01em' }}>
            Convoy Intelligence
          </div>
          <div style={{ fontSize: 11, color: '#4b5563', marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>
            CFO Photo Reports
          </div>
        </div>

        <div style={S.statsGrid}>
          {[
            { label: 'Convoys', value: stats.total, icon: <Truck size={12} />, accent: '#60a5fa' },
            { label: 'Active', value: stats.active, icon: <ShieldCheck size={12} />, accent: '#22c55e' },
            { label: 'Complete', value: stats.complete, icon: <TrendingUp size={12} />, accent: '#d97706' },
            { label: 'GPS Flags', value: stats.mismatches, icon: <AlertTriangle size={12} />, accent: '#ef4444' },
          ].map(({ label, value, icon, accent }) => (
            <div key={label} style={S.statCard(accent)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4, color: accent }}>
                {icon}
                <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em',
                  textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace' }}>{label}</span>
              </div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 22, color: '#f1f5f9' }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        <div style={S.tabs}>
          {(['all', 'active', 'completed', 'pending'] as FilterTab[]).map(t => (
            <button key={t} style={S.tab(filter === t)} onClick={() => setFilter(t)}>
              {t}
            </button>
          ))}
        </div>

        <div style={S.convoyList}>
          {overviewLoading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
              <Loader2 size={18} className="animate-spin" style={{ color: '#4b5563' }} />
            </div>
          )}
          {filtered.length === 0 && !overviewLoading && (
            <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 12, color: '#4b5563' }}>
              No convoys found.
            </div>
          )}
          {filtered.map(item => (
            <ConvoyCard
              key={item.id}
              item={item}
              selected={selectedId === item.id}
              onClick={() => handleSelectConvoy(item)}
            />
          ))}
        </div>
      </aside>

      <main style={S.viewer}>
        {!selectedId && (
          <div style={{ ...S.emptyViewer, height: '100%' }}>
            <Truck size={40} style={{ opacity: 0.2 }} />
            <span style={{ fontSize: 14, fontFamily: "'Space Grotesk', sans-serif" }}>
              Select a convoy to view its report
            </span>
          </div>
        )}
        {selectedId && detailLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '40vh', gap: 10, color: '#4b5563' }}>
            <Loader2 size={20} className="animate-spin" />
            <span style={{ fontSize: 13 }}>Loading report…</span>
          </div>
        )}
        {selectedId && !detailLoading && !selectedDate && (
          <div style={{ ...S.emptyViewer, height: '40vh', color: '#6b7280' }}>
            <span style={{ fontSize: 13 }}>No report available for this convoy yet.</span>
          </div>
        )}
        {selectedId && selectedDate && detailError && !detailLoading && (
          <div style={{ ...S.emptyViewer, height: '40vh', color: '#ef4444', gap: 8 }}>
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
