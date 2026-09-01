import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card.js';
import { StatusBadge } from '@/components/ui/Badge.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { api } from '@/lib/api.js';

const s = (v: unknown) => String(v ?? '—');

export default function LiveOperations() {
  const { data, isLoading } = useQuery<{ data: Record<string, unknown>[]; total: number }>({
    queryKey: ['trips', 'dispatched'],
    queryFn: async () => {
      const { data } = await api.get('/trips', { params: { status: 'dispatched' } });
      return data;
    },
    refetchInterval: 15_000,
  });

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading…</div></div>;

  const activeTrips = data?.data ?? [];

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Live Operations"
        description="Real-time truck positions, geofences, and route history across all active trips."
      />

      <div className="grid grid-cols-[1.8fr_1fr] gap-4 items-start">
        <Card className="h-[480px] p-0 relative overflow-hidden">
          <div className="w-full h-full relative" style={{
            background: 'linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px) 0 0/40px 40px, linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px) 0 0/40px 40px, radial-gradient(600px 300px at 20% 20%, rgba(255,122,0,0.06), transparent), #14171b',
          }}>
            <div className="absolute top-3.5 left-4 z-10">
              <div className="font-display font-bold text-[13px]">Live Fleet Map</div>
              <div className="text-2xs text-text-2 font-mono">{activeTrips.length} active trips</div>
            </div>
            {activeTrips.slice(0, 8).map((_, i) => (
              <div key={i} className="absolute w-[11px] h-[11px] rounded-full bg-cds-orange shadow-[0_0_0_4px_rgba(255,122,0,0.13),0_0_14px_rgba(255,122,0,0.35)] animate-pulse-dot" style={{ left: `${12 + i * 11}%`, top: `${18 + (i % 5) * 15}%`, animationDelay: `${i * 0.3}s` }} />
            ))}
            <div className="absolute bottom-3.5 left-4 flex gap-3.5 z-10 text-2xs text-text-1 font-mono">
              <span className="flex items-center gap-[5px]"><span className="w-[7px] h-[7px] rounded-full bg-cds-orange" />Truck en route</span>
              <span className="flex items-center gap-[5px]"><span className="w-[7px] h-[7px] rounded-full bg-cds-teal" />Port / warehouse</span>
            </div>
          </div>
        </Card>

        <Card className="max-h-[480px] overflow-y-auto p-4">
          <div className="font-display font-bold text-[13px] mb-2.5">Trips in Motion</div>
          {activeTrips.map((t) => (
            <div key={s(t.id)} className="flex gap-2.5 py-2.5 border-b border-hair last:border-b-0 cursor-pointer hover:bg-ink-2 rounded-lg px-2 -mx-2 transition-colors">
              <div className="w-[26px] h-[26px] rounded-lg flex-none flex items-center justify-center bg-ink-3 text-cds-orange">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12h13M13 6l7 6-7 6" /></svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs-tight text-text-0">{s(t.container_number)} <span className="text-text-2">{s(t.vehicle_reg)}</span></div>
                <div className="text-2xs text-text-2 mt-0.5 font-mono">{s(t.origin)} → {s(t.destination)}</div>
              </div>
              <StatusBadge status={s(t.status)} />
            </div>
          ))}
          {activeTrips.length === 0 && (
            <div className="text-center text-text-2 text-xs py-8 font-mono">No active trips.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
