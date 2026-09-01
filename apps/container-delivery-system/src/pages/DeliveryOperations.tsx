import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card.js';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { Tabs } from '@/components/ui/Tabs.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { api } from '@/lib/api.js';

const s = (v: unknown) => String(v ?? '—');

const statusLabels: Record<string, { label: string; variant: 'ok' | 'warn' | 'neutral' }> = {
  awaiting_unclamp: { label: 'AWAITING UNCLAMP', variant: 'warn' },
  unclamping: { label: 'UNCLAMPING', variant: 'ok' },
  awaiting_bay: { label: 'QUEUED', variant: 'neutral' },
  at_port: { label: 'AT PORT', variant: 'warn' },
  delivered: { label: 'DELIVERED', variant: 'ok' },
};

export default function DeliveryOperations() {
  const [tab, setTab] = useState('queue');

  const { data: queueData, isLoading: queueLoading } = useQuery<{ data: Record<string, unknown>[]; total: number }>({
    queryKey: ['trips', 'at_port'],
    queryFn: async () => {
      const { data } = await api.get('/trips', { params: { status: 'at_port' } });
      return data;
    },
  });

  const { data: completedData, isLoading: completedLoading } = useQuery<{ data: Record<string, unknown>[]; total: number }>({
    queryKey: ['trips', 'delivered'],
    queryFn: async () => {
      const { data } = await api.get('/trips', { params: { status: 'delivered' } });
      return data;
    },
  });

  if (queueLoading || completedLoading) return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading…</div></div>;

  const queueItems = queueData?.data ?? [];
  const completedItems = completedData?.data ?? [];

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Delivery Operations"
        description="Port & destination unclamp queue, bay assignment, and delivery confirmation."
        actions={
          <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
            Manual Entry
          </Button>
        }
      />

      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          { label: 'In Queue', value: String(queueItems.length), color: 'text-cds-orange' },
          { label: 'Completed Today', value: String(completedItems.length), color: 'text-cds-teal' },
        ].map((kpi) => (
          <Card key={kpi.label} className="p-3.5">
            <div className="text-2xs font-mono text-text-2 uppercase tracking-wider">{kpi.label}</div>
            <div className={`text-[22px] font-display font-bold mt-1 ${kpi.color}`}>{kpi.value}</div>
          </Card>
        ))}
      </div>

      <Tabs
        tabs={[
          { id: 'queue', label: 'Queue', count: queueItems.length },
          { id: 'completed', label: 'Completed', count: completedItems.length },
          { id: 'returned', label: 'Returns', count: 0 },
        ]}
        activeId={tab}
        onChange={setTab}
        variant="pills"
      />

      <div className="glass p-0 mt-4">
        <div className="overflow-x-auto">
          {tab === 'queue' && (
            <table className="w-full border-collapse text-xs-tight">
              <thead>
                <tr>
                  {['Container', 'Origin', 'Destination', 'Vehicle', 'Driver', 'Status', 'Actions'].map((h) => (
                    <th key={h} className="text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {queueItems.map((q) => {
                  const status = s(q.status);
                  const sl = statusLabels[status];
                  return (
                    <tr key={s(q.id)} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors">
                      <td className="px-3.5 py-3 font-mono font-semibold text-text-0">{s(q.container_number)}</td>
                      <td className="px-3.5 py-3 text-text-0">{s(q.origin)}</td>
                      <td className="px-3.5 py-3 text-text-0">{s(q.destination)}</td>
                      <td className="px-3.5 py-3 font-mono text-text-1">{s(q.vehicle_reg)}</td>
                      <td className="px-3.5 py-3 text-text-0">{s(q.driver_name)}</td>
                      <td className="px-3.5 py-3"><Badge variant={sl?.variant ?? 'neutral'}>{sl?.label ?? status.toUpperCase()}</Badge></td>
                      <td className="px-3.5 py-3">
                        <div className="flex gap-1.5">
                          {status === 'awaiting_bay' && <Button size="sm">Assign Bay</Button>}
                          {status === 'awaiting_unclamp' && <Button size="sm" variant="success">Authorize Unclamp</Button>}
                          {status === 'unclamping' && <Button size="sm" variant="success">Confirm Delivery</Button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {queueItems.length === 0 && (
                  <tr><td colSpan={7} className="px-3.5 py-8 text-center text-text-2 text-xs">No items in queue.</td></tr>
                )}
              </tbody>
            </table>
          )}

          {tab === 'completed' && (
            <table className="w-full border-collapse text-xs-tight">
              <thead>
                <tr>
                  {['Container', 'Origin', 'Destination', 'Vehicle', 'Driver', 'Status'].map((h) => (
                    <th key={h} className="text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {completedItems.map((c) => (
                  <tr key={s(c.id)} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors">
                    <td className="px-3.5 py-3 font-mono font-semibold text-text-0">{s(c.container_number)}</td>
                    <td className="px-3.5 py-3 text-text-0">{s(c.origin)}</td>
                    <td className="px-3.5 py-3 text-text-0">{s(c.destination)}</td>
                    <td className="px-3.5 py-3 font-mono text-text-1">{s(c.vehicle_reg)}</td>
                    <td className="px-3.5 py-3 text-text-0">{s(c.driver_name)}</td>
                    <td className="px-3.5 py-3"><Badge variant="ok">DELIVERED</Badge></td>
                  </tr>
                ))}
                {completedItems.length === 0 && (
                  <tr><td colSpan={6} className="px-3.5 py-8 text-center text-text-2 text-xs">No completed deliveries.</td></tr>
                )}
              </tbody>
            </table>
          )}

          {tab === 'returned' && (
            <div className="flex items-center justify-center h-40 text-text-2 text-sm-tight">No pending container returns.</div>
          )}
        </div>
      </div>
    </div>
  );
}
