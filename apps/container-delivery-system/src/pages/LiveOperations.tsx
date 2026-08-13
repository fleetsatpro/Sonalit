import React from 'react';
import { Card } from '@/components/ui/Card.js';
import { StatusBadge } from '@/components/ui/Badge.js';
import { PageHeader } from '@/components/ui/PageHeader.js';

const activeTrips = [
  { id: 'TGHU3456789', truck: 'KDK 456P', origin: 'Nakuru WH', dest: 'Mombasa Port', eta: '18:40', status: 'transit' },
  { id: 'CMAU5581223', truck: 'KDA 112B', origin: 'Naivasha WH', dest: 'JKIA Cargo', eta: '21:10 (+2h)', status: 'delayed' },
  { id: 'HLXU9903312', truck: 'KCE 771D', origin: 'Eldoret WH', dest: 'Mombasa Port', eta: '23:05', status: 'transit' },
  { id: 'OOCL2261890', truck: 'KDG 330F', origin: 'Thika WH', dest: 'Mombasa Port', eta: '19:50', status: 'transit' },
  { id: 'EGLV1129003', truck: 'KDF 887M', origin: 'Kericho WH', dest: 'Mombasa Port', eta: '20:30 (+3h)', status: 'delayed' },
  { id: 'MSCU7712340', truck: 'KBZ 902L', origin: 'Kericho WH', dest: 'Mombasa Port', eta: 'Arrived', status: 'delivered' },
  { id: 'CSNU8834221', truck: 'KBW 556J', origin: "Murang'a WH", dest: 'Mombasa Port', eta: 'Arrived', status: 'delivered' },
];

export default function LiveOperations() {
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
              <div className="font-display font-bold text-[13px]">Kenya Corridor — Nakuru ⇄ Mombasa</div>
              <div className="text-2xs text-text-2 font-mono">{activeTrips.length} active · geofence: Mariakani, Voi, Mtito Andei</div>
            </div>
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 600 480" preserveAspectRatio="none">
              <path d="M50,60 C 180,140 260,220 340,280 S 520,380 560,420" fill="none" stroke="#ff7a00" strokeWidth="2" strokeDasharray="6 5" opacity="0.55" />
            </svg>
            {activeTrips.filter((t) => t.status !== 'delivered').map((_, i) => (
              <div key={i} className="absolute w-[11px] h-[11px] rounded-full bg-cds-orange shadow-[0_0_0_4px_rgba(255,122,0,0.13),0_0_14px_rgba(255,122,0,0.35)] animate-pulse-dot" style={{ left: `${12 + i * 11}%`, top: `${18 + (i % 5) * 15}%`, animationDelay: `${i * 0.3}s` }} title={activeTrips[i].id} />
            ))}
            <div className="absolute w-[9px] h-[9px] rounded-sm bg-cds-teal shadow-glow-teal" style={{ left: '92%', top: '88%' }} />
            <div className="absolute bottom-3.5 left-4 flex gap-3.5 z-10 text-2xs text-text-1 font-mono">
              <span className="flex items-center gap-[5px]"><span className="w-[7px] h-[7px] rounded-full bg-cds-orange" />Truck en route</span>
              <span className="flex items-center gap-[5px]"><span className="w-[7px] h-[7px] rounded-full bg-cds-teal" />Port / warehouse</span>
            </div>
          </div>
        </Card>

        <Card className="max-h-[480px] overflow-y-auto p-4">
          <div className="font-display font-bold text-[13px] mb-2.5">Trips in Motion</div>
          {activeTrips.map((t) => (
            <div key={t.id} className="flex gap-2.5 py-2.5 border-b border-hair last:border-b-0 cursor-pointer hover:bg-ink-2 rounded-lg px-2 -mx-2 transition-colors">
              <div className="w-[26px] h-[26px] rounded-lg flex-none flex items-center justify-center bg-ink-3 text-cds-orange">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 12h13M13 6l7 6-7 6" /></svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs-tight text-text-0">{t.id} <span className="text-text-2">— {t.truck}</span></div>
                <div className="text-2xs text-text-2 mt-0.5 font-mono">{t.origin} → {t.dest} · ETA {t.eta}</div>
              </div>
              <StatusBadge status={t.status} />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
