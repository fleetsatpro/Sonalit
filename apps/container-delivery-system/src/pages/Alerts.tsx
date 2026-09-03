import React, { useState } from 'react';
import { Card } from '@/components/ui/Card.js';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { Tabs } from '@/components/ui/Tabs.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api.js';

const s = (v: unknown) => String(v ?? '—');

const severityStyles: Record<string, { dot: string; badge: 'bad' | 'warn' | 'ok' | 'neutral' }> = {
  critical: { dot: 'bg-cds-red', badge: 'bad' },
  high: { dot: 'bg-cds-red', badge: 'bad' },
  medium: { dot: 'bg-cds-amber', badge: 'warn' },
  low: { dot: 'bg-cds-teal', badge: 'ok' },
  info: { dot: 'bg-text-2', badge: 'neutral' },
};

export default function Alerts() {
  const [filter, setFilter] = useState('all');

  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ data: Record<string, unknown>[] }>({
    queryKey: ['alerts'],
    queryFn: async () => { const { data: d } = await api.get('/alerts'); return d; },
    refetchInterval: 15_000,
  });

  const ackMutation = useMutation({
    mutationFn: async (id: string) => { await api.patch(`/alerts/${id}/acknowledge`); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading…</div></div>;

  const alerts = data?.data ?? [];
  const filtered = filter === 'all' ? alerts : alerts.filter((a) => s(a['severity']) === filter);
  const unacked = alerts.filter((a) => !a['acknowledged']).length;

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Alerts"
        description={`${unacked} unacknowledged · ${alerts.length} total in last 24h`}
        actions={
          <div className="flex gap-2">
            <Button variant="ghost">Mark All Read</Button>
            <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" /><circle cx="12" cy="12" r="3" /></svg>}>
              Alert Rules
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Critical', value: alerts.filter((a) => s(a['severity']) === 'critical').length, color: 'text-cds-red' },
          { label: 'High', value: alerts.filter((a) => s(a['severity']) === 'high').length, color: 'text-cds-red' },
          { label: 'Medium', value: alerts.filter((a) => s(a['severity']) === 'medium').length, color: 'text-cds-amber' },
          { label: 'Low', value: alerts.filter((a) => s(a['severity']) === 'low').length, color: 'text-cds-teal' },
        ].map((kpi) => (
          <Card key={kpi.label} className="p-3.5">
            <div className="text-2xs font-mono text-text-2 uppercase tracking-wider">{kpi.label}</div>
            <div className={`text-[22px] font-display font-bold mt-1 ${kpi.color}`}>{kpi.value}</div>
          </Card>
        ))}
      </div>

      <Tabs
        tabs={[
          { id: 'all', label: 'All' },
          { id: 'critical', label: 'Critical' },
          { id: 'high', label: 'High' },
          { id: 'medium', label: 'Medium' },
          { id: 'low', label: 'Low' },
        ]}
        activeId={filter}
        onChange={setFilter}
        variant="pills"
      />

      <div className="glass p-0 mt-4">
        <div className="space-y-0">
          {filtered.map((a, i) => {
            const severity = s(a['severity']);
            const style = severityStyles[severity] ?? severityStyles['info']!;
            const acked = Boolean(a['acknowledged']);
            return (
              <div key={s(a['id'] ?? i)} className={`flex items-start gap-3 px-4 py-3.5 border-b border-hair cursor-pointer hover:bg-ink-2 transition-colors ${!acked ? 'bg-ink-1' : ''}`}>
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-none ${style.dot} ${!acked ? 'animate-pulse-dot' : 'opacity-40'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs-tight font-semibold text-text-0">{s(a['type'])}</span>
                    <span className="text-2xs font-mono text-text-2">{s(a['entity_id'] ?? a['entity_type'])}</span>
                    <Badge variant={style.badge}>{severity.toUpperCase()}</Badge>
                  </div>
                  <div className="text-xs text-text-1 mt-0.5">{s(a['message'])}</div>
                  <div className="text-2xs text-text-2 font-mono mt-1">{s(a['id'])} · {s(a['time'] ?? a['created_at'])}</div>
                </div>
                {!acked && (
                  <Button size="sm" variant="ghost" onClick={() => ackMutation.mutate(s(a['id']))}>ACK</Button>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && <div className="px-4 py-8 text-center text-text-2 text-xs">No alerts match.</div>}
        </div>
      </div>
    </div>
  );
}
