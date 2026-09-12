import React from 'react';
import { Card } from '@/components/ui/Card.js';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { DrawerField, DrawerSection } from '@/components/ui/Drawer.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { ProgressBar } from '@/components/ui/ProgressBar.js';
import { useUIStore } from '@/stores/ui.js';
import { useLocks } from '@/hooks/useLocks.js';

const s = (v: unknown) => String(v ?? '—');

const signalColor = (sig: string) => sig === 'strong' ? 'text-cds-teal' : sig === 'medium' ? 'text-cds-amber' : sig === 'weak' ? 'text-cds-amber' : 'text-cds-red';
const battColor = (b: number) => b >= 60 ? 'bg-cds-teal' : b >= 30 ? 'bg-cds-amber' : 'bg-cds-red';

function healthDot(l: Record<string, unknown>) {
  const status = s(l['status']);
  const signal = s(l['signal_strength']);
  if (status === 'tamper') return 'bg-cds-red shadow-[0_0_8px_var(--cds-red)]';
  if (signal === 'offline') return 'bg-cds-red shadow-[0_0_8px_var(--cds-red)]';
  if (signal === 'strong') return 'bg-cds-teal shadow-glow-teal';
  return 'bg-cds-amber shadow-[0_0_8px_rgba(255,176,32,0.6)]';
}

export default function Locks() {
  const { openDrawer, addToast } = useUIStore();
  const { data: lockData, isLoading } = useLocks();

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading…</div></div>;

  const locks = (lockData?.data ?? []) as Record<string, unknown>[];

  const openLockDrawer = (l: Record<string, unknown>) => {
    const battery = Number(l['battery_level'] ?? 0);
    openDrawer(s(l['serial']), (
      <div>
        <div className="text-2xs text-text-2 font-mono mb-4">{s(l['location'])}</div>
        <DrawerSection title="Device Health">
          <DrawerField label="Battery" value={<ProgressBar value={battery} color={battColor(battery)} showLabel />} />
          <DrawerField label="Solar charging" value={l['solar_charging'] ? 'Yes' : 'No'} />
          <DrawerField label="Signal" value={<span className={signalColor(s(l['signal_strength']))}>{s(l['signal_strength'])}</span>} />
          <DrawerField label="Last heartbeat" value={s(l['last_heartbeat'])} />
          <DrawerField label="Temperature" value={s(l['temperature'])} />
          <DrawerField label="Tamper status" value={s(l['status']) === 'tamper' ? <span className="text-cds-red">Alert active</span> : 'Normal'} />
        </DrawerSection>
        <DrawerSection title="Assignment">
          <DrawerField label="Container" value={s(l['container_number'])} />
          <DrawerField label="Truck" value={s(l['truck'])} />
        </DrawerSection>
        <div className="flex gap-2 mt-5">
          <Button className="flex-1" onClick={() => addToast(`Ping sent to lock ${s(l['serial'])}`)}>Ping Lock</Button>
          <Button variant="ghost" className="flex-1" onClick={() => addToast(`Lock ${s(l['serial'])} flagged for maintenance`)}>Flag Maintenance</Button>
        </div>
      </div>
    ));
  };

  const tamperCount = locks.filter((l) => s(l['status']) === 'tamper').length;
  const offlineCount = locks.filter((l) => s(l['signal_strength']) === 'offline').length;

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="E-Lock Management"
        description={`${locks.length} solar-powered locks in the fleet · ${tamperCount} tamper alert · ${offlineCount} offline`}
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => addToast('Bulk sync initiated')}>Sync All</Button>
            <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
              Add Lock
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3.5">
        {locks.map((l, i) => {
          const battery = Number(l['battery_level'] ?? 0);
          const signal = s(l['signal_strength']);
          const serial = s(l['serial'] ?? i);
          return (
            <Card key={serial} hover onClick={() => openLockDrawer(l)} className="p-4">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="font-mono font-bold text-sm text-text-0">{serial}</div>
                  <div className="text-2xs text-text-2 mt-0.5">{s(l['location'])}</div>
                </div>
                <span className={`w-2 h-2 rounded-full flex-none ${healthDot(l)}`} />
              </div>
              <div className="flex justify-between text-xs-tight text-text-1 py-[5px] border-t border-hair">
                <span>Battery</span>
                <span className="text-text-0 font-mono flex items-center gap-1.5">
                  <span className="w-[46px] h-1.5 rounded bg-ink-3 overflow-hidden">
                    <div className={`h-full rounded ${battColor(battery)}`} style={{ width: `${battery}%` }} />
                  </span>
                  {battery}%
                </span>
              </div>
              <div className="flex justify-between text-xs-tight text-text-1 py-[5px] border-t border-hair">
                <span>Solar</span>
                <span className="text-text-0 font-mono">{l['solar_charging'] ? 'Charging' : 'Idle'}</span>
              </div>
              <div className="flex justify-between text-xs-tight text-text-1 py-[5px] border-t border-hair">
                <span>Signal</span>
                <span className={`font-mono ${signalColor(signal)}`}>{signal}</span>
              </div>
              <div className="flex justify-between text-xs-tight text-text-1 py-[5px] border-t border-hair">
                <span>Container</span>
                <span className="text-text-0 font-mono">{s(l['container_number'])}</span>
              </div>
              <div className="flex justify-between text-xs-tight text-text-1 py-[5px] border-t border-hair">
                <span>Heartbeat</span>
                <span className="text-text-0 font-mono">{s(l['last_heartbeat'])}</span>
              </div>
              {s(l['status']) === 'tamper' && (
                <div className="mt-2.5">
                  <Badge variant="bad" dot>TAMPER ALERT</Badge>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
