import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { api } from '@/lib/api.js';

const s = (v: unknown) => String(v ?? '—');

export default function Analytics() {
  const { data, isLoading } = useQuery<Record<string, unknown>>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const { data } = await api.get('/dashboard');
      return data;
    },
    refetchInterval: 30_000,
  });

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading…</div></div>;

  const kpis = [
    { label: 'Active Containers', value: s(data?.active_containers) },
    { label: 'In Transit', value: s(data?.in_transit) },
    { label: 'Delivered Today', value: s(data?.delivered_today) },
    { label: 'Active Locks', value: s(data?.active_locks) },
    { label: 'Locks Removed', value: s(data?.locks_removed) },
    { label: 'Pending Unclamp', value: s(data?.pending_unclamp) },
    { label: 'Delayed Trips', value: s(data?.delayed_trips) },
    { label: 'Avg Transit Hours', value: s(data?.avg_transit_hours) },
  ];

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Analytics"
        description="Fleet performance, delivery trends, and operational insights."
      />

      <div className="grid grid-cols-4 gap-3 mb-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="p-3.5">
            <div className="text-2xs font-mono text-text-2 uppercase tracking-wider">{kpi.label}</div>
            <div className="text-[22px] font-display font-bold text-text-0 mt-1">{kpi.value}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <Card className="p-4">
          <div className="font-display font-bold text-sm-tight mb-3">Delivery Trends</div>
          <div className="flex items-center justify-center h-[160px] text-text-2 text-xs font-mono">
            Data populates as operations run
          </div>
        </Card>

        <Card className="p-4">
          <div className="font-display font-bold text-sm-tight mb-4">Fleet Utilization</div>
          <div className="flex items-center justify-center h-[140px] text-text-2 text-xs font-mono">
            Data populates as operations run
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <Card className="p-4">
          <div className="font-display font-bold text-sm-tight mb-4">Lock Health Distribution</div>
          <div className="flex items-center justify-center h-[140px] text-text-2 text-xs font-mono">
            Data populates as operations run
          </div>
        </Card>

        <Card className="p-4">
          <div className="font-display font-bold text-sm-tight mb-3">Route Performance</div>
          <div className="flex items-center justify-center h-[140px] text-text-2 text-xs font-mono">
            Data populates as operations run
          </div>
        </Card>
      </div>
    </div>
  );
}
