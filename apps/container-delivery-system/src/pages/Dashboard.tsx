import React from 'react';
import { KPICard } from '@/components/ui/KPICard.js';
import { Card } from '@/components/ui/Card.js';
import { StatusBadge } from '@/components/ui/Badge.js';
import { useUIStore } from '@/stores/ui.js';
import { useDashboard, useActivityFeed } from '@/hooks/useDashboard.js';
import { useContainers } from '@/hooks/useContainers.js';

const iconPaths: Record<string, string> = {
  clamp: 'M5 11h14v9H5zM8 11V7a4 4 0 0 1 8 0v4',
  depart: 'M3 12h13M13 6l7 6-7 6',
  checkpoint: 'M12 8v4l3 2',
  sync: 'M21 12a9 9 0 1 1-2.6-6.36M21 3v6h-6',
  arrival: 'M3 21h18M4 21V10l8-6 8 6v11',
  unclamp: 'M5 11h14v9H5zM8 11V9a4 4 0 0 1 7.5-1.9',
  ai: 'M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5',
};

const s = (v: unknown) => String(v ?? '—');

export default function Dashboard() {
  const { addToast } = useUIStore();
  const { data: dashboard, isLoading: dashLoading } = useDashboard();
  const { data: activityData } = useActivityFeed();
  const { data: containerData } = useContainers();

  if (dashLoading) return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading…</div></div>;

  const d = dashboard as Record<string, unknown> | undefined;

  const kpis = [
    { label: 'ACTIVE CONTAINERS', value: s(d?.['active_containers']), delta: '', trend: 'up' as const, sparkline: [] as number[] },
    { label: 'IN TRANSIT', value: s(d?.['in_transit']), delta: '', trend: 'up' as const, sparkline: [] as number[] },
    { label: 'DELIVERED TODAY', value: s(d?.['delivered_today']), delta: '', trend: 'up' as const, sparkline: [] as number[] },
    { label: 'ACTIVE LOCKS', value: s(d?.['active_locks']), delta: '', trend: 'up' as const, sparkline: [] as number[] },
    { label: 'LOCKS REMOVED TODAY', value: s(d?.['locks_removed']), delta: '', trend: 'up' as const, sparkline: [] as number[] },
    { label: 'PENDING UNCLAMP', value: s(d?.['pending_unclamp']), delta: '', trend: 'down' as const, sparkline: [] as number[] },
    { label: 'DELAYED TRIPS', value: s(d?.['delayed_trips']), delta: '', trend: 'down' as const, sparkline: [] as number[] },
    { label: 'AVG TRANSIT TIME', value: s(d?.['avg_transit_hours']), delta: '', trend: 'up' as const, sparkline: [] as number[] },
  ];

  const activities = (Array.isArray(activityData) ? activityData : (d?.['recent_activity'] as unknown[] ?? [])) as Record<string, unknown>[];
  const containers = ((containerData as Record<string, unknown> | undefined)?.['data'] as Record<string, unknown>[] | undefined) ?? [];

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <div className="grid grid-cols-4 gap-3.5 mb-5">
        {kpis.map((kpi) => (
          <KPICard key={kpi.label} {...kpi} />
        ))}
      </div>

      <div className="grid grid-cols-[1.7fr_1fr] gap-4 items-start">
        <Card className="h-[360px] p-0 relative overflow-hidden">
          <div className="w-full h-full relative" style={{
            background: 'linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px) 0 0/40px 40px, linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px) 0 0/40px 40px, radial-gradient(600px 300px at 20% 20%, rgba(255,122,0,0.06), transparent), #14171b',
          }}>
            <div className="absolute top-3.5 left-4 z-10">
              <div className="font-display font-bold text-[13px]">Live Operations Map</div>
              <div className="text-2xs text-text-2 font-mono">{s(d?.['in_transit'])} trucks in motion</div>
            </div>
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 600 360" preserveAspectRatio="none">
              <path d="M60,60 C 200,120 260,180 340,200 S 520,280 560,300" fill="none" stroke="#ff7a00" strokeWidth="2" strokeDasharray="6 5" opacity="0.55" />
              <path d="M40,300 C 150,260 220,150 380,110 S 540,80 570,60" fill="none" stroke="#ff7a00" strokeWidth="2" strokeDasharray="6 5" opacity="0.55" />
            </svg>
            {[{ left: '22%', top: '38%' }, { left: '48%', top: '56%' }, { left: '71%', top: '29%' }, { left: '34%', top: '74%' }].map((pos, i) => (
              <div key={i} className="absolute w-[11px] h-[11px] rounded-full bg-cds-orange shadow-[0_0_0_4px_rgba(255,122,0,0.13),0_0_14px_rgba(255,122,0,0.35)] animate-pulse-dot" style={{ left: pos.left, top: pos.top, animationDelay: `${i * 0.3}s` }} />
            ))}
            <div className="absolute w-[9px] h-[9px] rounded-sm bg-cds-teal shadow-glow-teal" style={{ left: '92%', top: '83%' }} />
            <div className="absolute w-[9px] h-[9px] rounded-sm bg-cds-teal shadow-glow-teal" style={{ left: '8%', top: '12%' }} />
            <div className="absolute bottom-3.5 left-4 flex gap-3.5 z-10 text-2xs text-text-1 font-mono">
              <span className="flex items-center gap-[5px]"><span className="w-[7px] h-[7px] rounded-full bg-cds-orange" />Truck en route</span>
              <span className="flex items-center gap-[5px]"><span className="w-[7px] h-[7px] rounded-full bg-cds-teal" />Port / warehouse</span>
            </div>
          </div>
        </Card>

        <Card className="p-4 max-h-[360px] overflow-y-auto">
          <div className="font-display font-bold text-[13px] mb-1.5">Recent Activity</div>
          {activities.map((a, i) => {
            const icon = s(a['icon'] ?? a['type'] ?? 'checkpoint');
            return (
              <div key={i} className="flex gap-2.5 py-2.5 border-b border-hair last:border-b-0">
                <div className="w-[26px] h-[26px] rounded-lg flex-none flex items-center justify-center bg-ink-3 text-cds-orange">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    {icon === 'checkpoint' && <circle cx="12" cy="12" r="9" />}
                    <path d={iconPaths[icon] ?? iconPaths['checkpoint']!} />
                  </svg>
                </div>
                <div>
                  <div className="text-xs-tight text-text-0">{s(a['text'] ?? a['message'])}</div>
                  <div className="text-2xs text-text-2 mt-0.5 font-mono">{s(a['meta'] ?? a['timestamp'])}</div>
                </div>
              </div>
            );
          })}
          {activities.length === 0 && <div className="text-2xs text-text-2 py-4 text-center">No recent activity.</div>}
        </Card>
      </div>

      <div className="mt-5">
        <h3 className="font-display font-bold text-[15px] mb-3">Active Shipments</h3>
        <div className="glass p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs-tight">
              <thead>
                <tr>
                  {['Container', 'Status', 'Truck / Driver', 'Route', 'ETA'].map((h) => (
                    <th key={h} className="text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {containers.map((c, i) => (
                  <tr key={s(c['number'] ?? c['id'] ?? i)} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors" onClick={() => addToast(`Viewing ${s(c['number'] ?? c['id'])}`)}>
                    <td className="px-3.5 py-3 font-mono text-text-0">{s(c['number'] ?? c['id'])}</td>
                    <td className="px-3.5 py-3"><StatusBadge status={s(c['status'])} /></td>
                    <td className="px-3.5 py-3 text-text-0">{s(c['truck'])}<div className="text-2xs text-text-2 mt-0.5">{s(c['driver'])}</div></td>
                    <td className="px-3.5 py-3 text-text-0">{s(c['origin'])} → {s(c['destination'] ?? c['dest'])}</td>
                    <td className={`px-3.5 py-3 font-mono ${s(c['status']) === 'delayed' ? 'text-cds-red' : 'text-text-1'}`}>{s(c['eta'])}</td>
                  </tr>
                ))}
                {containers.length === 0 && <tr><td colSpan={5} className="px-3.5 py-8 text-center text-text-2">No active shipments.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
