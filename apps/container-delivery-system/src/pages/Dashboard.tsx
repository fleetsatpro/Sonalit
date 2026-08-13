import React from 'react';
import { KPICard } from '@/components/ui/KPICard.js';
import { Card } from '@/components/ui/Card.js';
import { StatusBadge } from '@/components/ui/Badge.js';
import { useUIStore } from '@/stores/ui.js';

const kpis = [
  { label: 'ACTIVE CONTAINERS', value: '128', delta: '+6 today', trend: 'up' as const, sparkline: [30, 45, 40, 55, 60, 70, 65, 72, 78, 82] },
  { label: 'IN TRANSIT', value: '54', delta: '+3 vs yesterday', trend: 'up' as const, sparkline: [20, 35, 30, 42, 48, 52, 50, 55, 58, 54] },
  { label: 'DELIVERED TODAY', value: '41', delta: '+12%', trend: 'up' as const, sparkline: [10, 18, 22, 28, 30, 35, 38, 40, 42, 41] },
  { label: 'ACTIVE LOCKS', value: '112', delta: '8 offline', trend: 'down' as const, sparkline: [100, 105, 108, 110, 112, 115, 114, 112, 110, 112] },
  { label: 'LOCKS REMOVED TODAY', value: '38', delta: '+9', trend: 'up' as const, sparkline: [5, 12, 18, 22, 25, 28, 30, 33, 36, 38] },
  { label: 'PENDING UNCLAMP', value: '6', delta: '2 delayed', trend: 'down' as const, sparkline: [8, 10, 7, 9, 6, 8, 7, 5, 6, 6] },
  { label: 'DELAYED TRIPS', value: '2', delta: '-1 vs yesterday', trend: 'up' as const, sparkline: [5, 4, 3, 4, 3, 2, 3, 2, 2, 2] },
  { label: 'AVG TRANSIT TIME', value: '6h 12m', delta: '-18m', trend: 'up' as const, sparkline: [80, 75, 72, 70, 68, 65, 62, 60, 58, 55] },
];

const activities = [
  { icon: 'clamp', text: 'Clamp completed — TGHU3456789 (SL23891)', meta: '09:17 · John Kamau · 99% confidence · WhatsApp' },
  { icon: 'depart', text: 'Truck departed — KDK 456P to Mombasa Port', meta: '09:18 · System · Auto-logged' },
  { icon: 'checkpoint', text: 'Checkpoint reached — A8, Mariakani', meta: '11:42 · GPS Beacon · 100%' },
  { icon: 'sync', text: 'Excel synchronized — 14 records', meta: '12:00 · System · Scheduled sync' },
  { icon: 'arrival', text: 'Port arrival — MSCU7712340', meta: '13:20 · Port Team A · Gate 4' },
  { icon: 'unclamp', text: 'Lock removed — SL23881', meta: '13:54 · Port Team A · 99% confidence' },
  { icon: 'ai', text: 'AI extracted data — Supervisor message flagged low confidence', meta: '13:40 · AI Extract v4 · 64%' },
];

const iconPaths: Record<string, string> = {
  clamp: 'M5 11h14v9H5zM8 11V7a4 4 0 0 1 8 0v4',
  depart: 'M3 12h13M13 6l7 6-7 6',
  checkpoint: 'M12 8v4l3 2',
  sync: 'M21 12a9 9 0 1 1-2.6-6.36M21 3v6h-6',
  arrival: 'M3 21h18M4 21V10l8-6 8 6v11',
  unclamp: 'M5 11h14v9H5zM8 11V9a4 4 0 0 1 7.5-1.9',
  ai: 'M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5',
};

const containers = [
  { id: 'TGHU3456789', status: 'transit', truck: 'KDK 456P', driver: 'John Kamau', origin: 'Nakuru WH', dest: 'Mombasa Port', eta: '18:40' },
  { id: 'MSCU7712340', status: 'delivered', truck: 'KBZ 902L', driver: 'Peter Otieno', origin: 'Kericho WH', dest: 'Mombasa Port', eta: 'Arrived' },
  { id: 'CMAU5581223', status: 'delayed', truck: 'KDA 112B', driver: 'Grace Wanjiru', origin: 'Naivasha WH', dest: 'JKIA Cargo', eta: '21:10 (+2h)' },
  { id: 'HLXU9903312', status: 'transit', truck: 'KCE 771D', driver: 'Samuel Kiptoo', origin: 'Eldoret WH', dest: 'Mombasa Port', eta: '23:05' },
  { id: 'OOCL2261890', status: 'transit', truck: 'KDG 330F', driver: 'Alice Njeri', origin: 'Thika WH', dest: 'Mombasa Port', eta: '19:50' },
];

export default function Dashboard() {
  const { addToast } = useUIStore();

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
              <div className="text-2xs text-text-2 font-mono">54 trucks in motion</div>
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
          {activities.map((a, i) => (
            <div key={i} className="flex gap-2.5 py-2.5 border-b border-hair last:border-b-0">
              <div className="w-[26px] h-[26px] rounded-lg flex-none flex items-center justify-center bg-ink-3 text-cds-orange">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  {a.icon === 'checkpoint' && <circle cx="12" cy="12" r="9" />}
                  <path d={iconPaths[a.icon] ?? iconPaths.checkpoint} />
                </svg>
              </div>
              <div>
                <div className="text-xs-tight text-text-0">{a.text}</div>
                <div className="text-2xs text-text-2 mt-0.5 font-mono">{a.meta}</div>
              </div>
            </div>
          ))}
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
                {containers.map((c) => (
                  <tr key={c.id} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors" onClick={() => addToast(`Viewing ${c.id}`)}>
                    <td className="px-3.5 py-3 font-mono text-text-0">{c.id}</td>
                    <td className="px-3.5 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-3.5 py-3 text-text-0">{c.truck}<div className="text-2xs text-text-2 mt-0.5">{c.driver}</div></td>
                    <td className="px-3.5 py-3 text-text-0">{c.origin} → {c.dest}</td>
                    <td className={`px-3.5 py-3 font-mono ${c.status === 'delayed' ? 'text-cds-red' : 'text-text-1'}`}>{c.eta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
