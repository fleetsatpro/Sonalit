import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card.js';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { Tabs } from '@/components/ui/Tabs.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api.js';

type AlertRow = Record<string, unknown>;
const s = (value: unknown) => String(value ?? '—');
const isAcknowledged = (row: AlertRow) => row['acknowledged'] === true || row['acknowledged'] === 'true';

const severityStyles: Record<string, { dot: string; badge: 'bad' | 'warn' | 'ok' | 'neutral' }> = {
  critical: { dot: 'bg-cds-red', badge: 'bad' },
  high: { dot: 'bg-cds-red', badge: 'bad' },
  medium: { dot: 'bg-cds-amber', badge: 'warn' },
  low: { dot: 'bg-cds-teal', badge: 'ok' },
  info: { dot: 'bg-text-2', badge: 'neutral' },
};

export default function Alerts() {
  const [filter, setFilter] = useState('all');
  const [operationMessage, setOperationMessage] = useState('');
  const queryClient = useQueryClient();

  const query = useQuery<{ data: AlertRow[]; total?: number }>({
    queryKey: ['alerts'],
    queryFn: async () => {
      const { data } = await api.get('/alerts', { params: { limit: 200 } });
      return data;
    },
    refetchInterval: 15_000,
    retry: 1,
  });

  const acknowledge = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post('/alerts/' + encodeURIComponent(id) + '/acknowledge');
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['alerts'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['cds-topbar-alert-count'] }),
      ]);
    },
  });

  const acknowledgeAll = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(ids.map(id =>
        api.post('/alerts/' + encodeURIComponent(id) + '/acknowledge')
      ));
      return {
        successful: results.filter(result => result.status === 'fulfilled').length,
        failed: results.filter(result => result.status === 'rejected').length,
      };
    },
    onSuccess: async result => {
      setOperationMessage(
        result.failed
          ? result.successful + ' alert(s) acknowledged; ' + result.failed + ' failed. Refresh to reconcile.'
          : result.successful + ' alert(s) acknowledged.'
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['alerts'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['cds-topbar-alert-count'] }),
      ]);
    },
    onError: () => setOperationMessage('Bulk acknowledgement failed. No successful change was confirmed.'),
  });

  const alerts = query.data?.data ?? [];
  const unacknowledged = useMemo(() => alerts.filter(row => !isAcknowledged(row)), [alerts]);
  const filtered = useMemo(
    () => filter === 'all' ? alerts : alerts.filter(row => s(row['severity']) === filter),
    [alerts, filter]
  );

  if (query.isLoading) {
    return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading CDS alerts…</div></div>;
  }

  return (
    <div className="p-6 pb-10 animate-fade-in space-y-4">
      <PageHeader
        title="Alerts"
        description={query.data
          ? unacknowledged.length + ' unacknowledged · ' + (query.data.total ?? alerts.length) + ' newest records available'
          : 'Live CDS alerts from the operational database.'}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" disabled={!unacknowledged.length || acknowledgeAll.isPending || query.isError}
              loading={acknowledgeAll.isPending}
              onClick={() => acknowledgeAll.mutate(unacknowledged.map(row => s(row['id'])).filter(id => id !== '—'))}>
              Acknowledge loaded alerts
            </Button>
            <Button variant="ghost" disabled title="Alert-rule editing is not exposed by the CDS API. No change will be made.">Alert rules unavailable</Button>
          </div>
        }
      />

      {query.isError && (
        <div role="alert" className="rounded-lg border border-red-400/20 bg-red-500/5 p-4 text-xs text-red-200">
          CDS alerts could not be loaded. The empty state below is not presented as a zero-alert result.
          <button type="button" onClick={() => { void query.refetch(); }} className="underline ml-2">Retry</button>
        </div>
      )}
      {operationMessage && <div role="status" className="rounded-lg border border-white/10 bg-white/[.025] px-3 py-2 text-xs text-text-1">{operationMessage}</div>}
      {acknowledge.isError && <div role="alert" className="text-xs text-red-200">Alert acknowledgement failed. The record will remain unacknowledged unless the backend confirms the change.</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-1">
        {[
          { label: 'Critical', value: alerts.filter(row => s(row['severity']) === 'critical').length, color: 'text-cds-red' },
          { label: 'High', value: alerts.filter(row => s(row['severity']) === 'high').length, color: 'text-cds-red' },
          { label: 'Medium', value: alerts.filter(row => s(row['severity']) === 'medium').length, color: 'text-cds-amber' },
          { label: 'Low', value: alerts.filter(row => s(row['severity']) === 'low').length, color: 'text-cds-teal' },
        ].map(kpi => (
          <Card key={kpi.label} className="p-3.5">
            <div className="text-2xs font-mono text-text-2 uppercase tracking-wider">{kpi.label}</div>
            <div className={'text-[22px] font-display font-bold mt-1 ' + kpi.color}>{query.isError ? '—' : kpi.value}</div>
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
          {filtered.map((row, index) => {
            const severity = s(row['severity']);
            const style = severityStyles[severity] ?? severityStyles.info!;
            const acknowledged = isAcknowledged(row);
            const id = s(row['id']);
            return (
              <div key={id === '—' ? index : id} className={'flex items-start gap-3 px-4 py-3.5 border-b border-hair hover:bg-ink-2 transition-colors ' + (!acknowledged ? 'bg-ink-1' : '')}>
                <div className={'w-2 h-2 rounded-full mt-1.5 flex-none ' + style.dot + (!acknowledged ? ' animate-pulse-dot' : ' opacity-40')} />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs-tight font-semibold text-text-0">{s(row['title'] ?? row['type'])}</span>
                    <span className="text-2xs font-mono text-text-2">{s(row['entity_id'] ?? row['entity_type'])}</span>
                    <Badge variant={style.badge}>{severity.toUpperCase()}</Badge>
                    {acknowledged && <span className="text-[9px] uppercase tracking-wider text-text-2">Acknowledged</span>}
                  </div>
                  <div className="text-xs text-text-1 mt-0.5">{s(row['message'])}</div>
                  <div className="text-2xs text-text-2 font-mono mt-1">{id} · {s(row['created_at'])}</div>
                </div>
                {!acknowledged && (
                  <Button size="sm" variant="ghost" disabled={acknowledge.isPending || acknowledgeAll.isPending || id === '—'}
                    onClick={() => acknowledge.mutate(id)}>ACK</Button>
                )}
              </div>
            );
          })}
          {!query.isError && filtered.length === 0 && <div className="px-4 py-8 text-center text-text-2 text-xs">No alerts match this filter.</div>}
        </div>
      </div>
      <div className="text-[10px] text-text-2">The list loads the newest 200 CDS alert records. Bulk acknowledgement applies to unacknowledged alerts in this loaded set, not records outside it.</div>
    </div>
  );
}
