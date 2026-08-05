import React from 'react';
import { Card } from '@/components/ui/Card.js';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { DrawerField } from '@/components/ui/Drawer.js';
import { useUIStore } from '@/stores/ui.js';

const locks = [
  { id: 'SL23891', battery: 88, solar: true, signal: 'strong' as const, container: 'TGHU3456789', truck: 'KDK 456P', heartbeat: '12s ago', location: 'A8, Mariakani', temp: '26°C', tamper: false },
  { id: 'SL23881', battery: 95, solar: true, signal: 'strong' as const, container: '—', truck: '—', heartbeat: '2m ago', location: 'Mombasa Port Gate 4', temp: '27°C', tamper: false },
  { id: 'SL24410', battery: 34, solar: false, signal: 'weak' as const, container: 'CMAU5581223', truck: 'KDA 112B', heartbeat: '6m ago', location: 'B3, Naivasha bypass', temp: '29°C', tamper: true },
  { id: 'SL24118', battery: 61, solar: true, signal: 'strong' as const, container: 'HLXU9903312', truck: 'KCE 771D', heartbeat: '40s ago', location: 'A104, Nakuru', temp: '25°C', tamper: false },
  { id: 'SL23977', battery: 72, solar: true, signal: 'medium' as const, container: 'OOCL2261890', truck: 'KDG 330F', heartbeat: '1m ago', location: 'Mombasa Rd, Mtito', temp: '28°C', tamper: false },
  { id: 'SL23652', battery: 11, solar: false, signal: 'offline' as const, container: '—', truck: '—', heartbeat: '3h ago', location: 'Unknown', temp: '—', tamper: false },
  { id: 'SL24290', battery: 47, solar: true, signal: 'medium' as const, container: 'EGLV1129003', truck: 'KDF 887M', heartbeat: '3m ago', location: 'A8, Voi', temp: '30°C', tamper: false },
  { id: 'SL23555', battery: 100, solar: true, signal: 'strong' as const, container: '—', truck: '—', heartbeat: '8s ago', location: 'Nakuru Depot', temp: '24°C', tamper: false },
];

const signalColor = (s: string) => s === 'strong' ? 'text-cds-teal' : s === 'medium' ? 'text-cds-amber' : s === 'weak' ? 'text-cds-amber' : 'text-cds-red';
const battColor = (b: number) => b >= 60 ? 'bg-cds-teal' : b >= 30 ? 'bg-cds-amber' : 'bg-cds-red';
const healthDot = (l: typeof locks[0]) => l.tamper ? 'bg-cds-red shadow-[0_0_8px_var(--cds-red)]' : l.signal === 'offline' ? 'bg-cds-red shadow-[0_0_8px_var(--cds-red)]' : l.signal === 'strong' ? 'bg-cds-teal shadow-[0_0_8px_rgba(51,214,168,0.6)]' : 'bg-cds-amber shadow-[0_0_8px_rgba(255,176,32,0.6)]';

export default function Locks() {
  const { openDrawer, addToast } = useUIStore();

  const openLockDrawer = (l: typeof locks[0]) => {
    openDrawer(l.id, (
      <div>
        <div className="text-[11px] text-text-2 font-mono mb-4">{l.location}</div>
        <DrawerField label="Battery" value={`${l.battery}%`} />
        <DrawerField label="Solar charging" value={l.solar ? 'Yes' : 'No'} />
        <DrawerField label="Signal" value={<span className={signalColor(l.signal)}>{l.signal}</span>} />
        <DrawerField label="Container" value={l.container} />
        <DrawerField label="Truck" value={l.truck} />
        <DrawerField label="Last heartbeat" value={l.heartbeat} />
        <DrawerField label="Temperature" value={l.temp} />
        <DrawerField label="Tamper status" value={l.tamper ? <span className="text-cds-red">Alert active</span> : 'Normal'} />
        <div className="flex gap-2 mt-4">
          <Button className="flex-1" onClick={() => addToast(`Ping sent to lock ${l.id}`)}>Ping Lock</Button>
          <Button variant="ghost" className="flex-1" onClick={() => addToast(`Lock ${l.id} flagged for maintenance`)}>Flag Maintenance</Button>
        </div>
      </div>
    ));
  };

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="font-display font-bold text-[17px] m-0">E-Lock Management</h2>
          <p className="text-[12px] text-text-2 m-0 mt-1">{locks.length} solar-powered locks in the fleet · {locks.filter((l) => l.tamper).length} tamper alert · {locks.filter((l) => l.signal === 'offline').length} offline</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => addToast('Bulk sync initiated')}>Sync All</Button>
          <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
            Add Lock
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3.5 mt-5">
        {locks.map((l) => (
          <Card key={l.id} className="p-4 cursor-pointer hover:border-[rgba(255,255,255,0.12)]" onClick={() => openLockDrawer(l)}>
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="font-mono font-bold text-sm text-text-0">{l.id}</div>
                <div className="text-[10.5px] text-text-2 mt-0.5">{l.location}</div>
              </div>
              <span className={`w-2 h-2 rounded-full flex-none ${healthDot(l)}`} />
            </div>
            <div className="flex justify-between text-[11.5px] text-text-1 py-[5px] border-t border-[rgba(255,255,255,0.07)]">
              <span>Battery</span>
              <span className="text-text-0 font-mono flex items-center gap-1.5">
                <span className="w-[46px] h-1.5 rounded bg-ink-3 overflow-hidden">
                  <div className={`h-full rounded ${battColor(l.battery)}`} style={{ width: `${l.battery}%` }} />
                </span>
                {l.battery}%
              </span>
            </div>
            <div className="flex justify-between text-[11.5px] text-text-1 py-[5px] border-t border-[rgba(255,255,255,0.07)]">
              <span>Solar</span>
              <span className="text-text-0 font-mono">{l.solar ? 'Charging' : 'Idle'}</span>
            </div>
            <div className="flex justify-between text-[11.5px] text-text-1 py-[5px] border-t border-[rgba(255,255,255,0.07)]">
              <span>Signal</span>
              <span className={`font-mono ${signalColor(l.signal)}`}>{l.signal}</span>
            </div>
            <div className="flex justify-between text-[11.5px] text-text-1 py-[5px] border-t border-[rgba(255,255,255,0.07)]">
              <span>Container</span>
              <span className="text-text-0 font-mono">{l.container}</span>
            </div>
            <div className="flex justify-between text-[11.5px] text-text-1 py-[5px] border-t border-[rgba(255,255,255,0.07)]">
              <span>Heartbeat</span>
              <span className="text-text-0 font-mono">{l.heartbeat}</span>
            </div>
            {l.tamper && (
              <div className="mt-2.5">
                <Badge variant="bad">⚠ TAMPER ALERT</Badge>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
