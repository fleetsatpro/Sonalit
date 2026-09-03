import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card.js';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { Tabs } from '@/components/ui/Tabs.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { api } from '@/lib/api.js';

const s = (v: unknown) => String(v ?? '—');

const severityColors: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-cds-red/15', text: 'text-cds-red' },
  high: { bg: 'bg-cds-red/15', text: 'text-cds-red' },
  medium: { bg: 'bg-cds-amber/15', text: 'text-cds-amber' },
  low: { bg: 'bg-cds-teal/15', text: 'text-cds-teal' },
};

const statusVariants: Record<string, 'bad' | 'warn' | 'ok' | 'neutral'> = {
  open: 'bad',
  investigating: 'warn',
  resolved: 'ok',
  closed: 'neutral',
};

export default function Incidents() {
  const [filter, setFilter] = useState('all');

  const { data, isLoading } = useQuery<{ data: Record<string, unknown>[]; total: number }>({
    queryKey: ['incidents'],
    queryFn: async () => { const { data: d } = await api.get('/incidents'); return d; },
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading...</div></div>;

  const incidents = (data?.data ?? []) as Record<string, unknown>[];
  const filtered = filter === 'all' ? incidents : incidents.filter((i) => s(i['status']) === filter);
  const openCount = incidents.filter((i) => s(i['status']) === 'open').length;
  const investigatingCount = incidents.filter((i) => s(i['status']) === 'investigating').length;
  const resolvedCount = incidents.filter((i) => s(i['status']) === 'resolved').length;

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Incidents"
        description={`${openCount} open · ${investigatingCount} under investigation`}
        actions={
          <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
            Report Incident
          </Button>
        }
      />

      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Open', value: openCount, color: 'text-cds-red' },
          { label: 'Investigating', value: investigatingCount, color: 'text-cds-amber' },
          { label: 'Resolved (7d)', value: resolvedCount, color: 'text-cds-teal' },
          { label: 'Total', value: data?.total ?? incidents.length, color: 'text-text-0' },
        ].map((kpi) => (
          <Card key={kpi.label} className="p-3.5">
            <div className="text-2xs font-mono text-text-2 uppercase tracking-wider">{kpi.label}</div>
            <div className={`text-[22px] font-display font-bold mt-1 ${kpi.color}`}>{kpi.value}</div>
          </Card>
        ))}
      </div>

      <Tabs
        tabs={[
          { id: 'all', label: 'All', count: incidents.length },
          { id: 'open', label: 'Open', count: openCount },
          { id: 'investigating', label: 'Investigating', count: investigatingCount },
          { id: 'resolved', label: 'Resolved', count: resolvedCount },
        ]}
        activeId={filter}
        onChange={setFilter}
        variant="pills"
      />

      <div className="glass p-0 mt-4">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs-tight">
            <thead>
              <tr>
                {['ID', 'Severity', 'Title', 'Type', 'Location', 'Assigned To', 'Created', 'Status'].map((h) => (
                  <th key={h} className="text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-text-2 text-xs">No incidents found</td></tr>
              )}
              {filtered.map((inc) => {
                const sev = severityColors[s(inc['severity'])] ?? severityColors['medium']!;
                return (
                  <tr key={s(inc['id'])} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors">
                    <td className="px-3.5 py-3 font-mono font-semibold text-text-0">{s(inc['id'])}</td>
                    <td className="px-3.5 py-3">
                      <span className={`px-2 py-0.5 rounded text-2xs font-mono font-semibold uppercase ${sev.bg} ${sev.text}`}>{s(inc['severity'])}</span>
                    </td>
                    <td className="px-3.5 py-3 text-text-0 max-w-[260px]">
                      <div className="truncate">{s(inc['title'])}</div>
                      {inc['shipment_id'] && <div className="text-2xs text-text-2 mt-0.5 font-mono">{s(inc['shipment_id'])}</div>}
                    </td>
                    <td className="px-3.5 py-3 font-mono text-text-1 capitalize">{s(inc['type']).replace(/_/g, ' ')}</td>
                    <td className="px-3.5 py-3 text-text-1">{s(inc['location'] ?? inc['lat'])}</td>
                    <td className="px-3.5 py-3 text-text-0">{inc['assigned_to'] ? s(inc['assigned_to']) : <span className="text-text-2">Unassigned</span>}</td>
                    <td className="px-3.5 py-3 font-mono text-text-2 text-2xs">{s(inc['created_at'])}</td>
                    <td className="px-3.5 py-3"><Badge variant={statusVariants[s(inc['status'])] ?? 'neutral'}>{s(inc['status']).toUpperCase()}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
