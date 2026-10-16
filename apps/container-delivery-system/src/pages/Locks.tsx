import { useState, type FormEvent } from 'react';
import { Card } from '@/components/ui/Card.js';
import { Badge } from '@/components/ui/Badge.js';
import { Button } from '@/components/ui/Button.js';
import { DrawerField, DrawerSection } from '@/components/ui/Drawer.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { ProgressBar } from '@/components/ui/ProgressBar.js';
import { useUIStore } from '@/stores/ui.js';
import { useLocks, useCreateLock, useUpdateLock } from '@/hooks/useLocks.js';

const s = (v: unknown) => String(v ?? '—');

const signalColor = (sig: string) => sig === 'strong' ? 'text-cds-teal' : sig === 'medium' ? 'text-cds-amber' : sig === 'weak' ? 'text-cds-amber' : 'text-cds-red';
const battColor = (b: number) => b >= 60 ? 'bg-cds-teal' : b >= 25 ? 'bg-cds-amber' : 'bg-cds-red';

function healthDot(l: Record<string, unknown>) {
  const status = s(l['status']);
  const signal = s(l['signal_strength']);
  if (l['tamper_detected'] === true || l['tamper_detected'] === 'true') return 'bg-cds-red shadow-[0_0_8px_var(--cds-red)]';
  if (status === 'offline' || status === 'maintenance') return 'bg-cds-red shadow-[0_0_8px_var(--cds-red)]';
  if (signal === 'offline') return 'bg-cds-red shadow-[0_0_8px_var(--cds-red)]';
  if (signal === 'strong') return 'bg-cds-teal shadow-glow-teal';
  return 'bg-cds-amber shadow-[0_0_8px_rgba(255,176,32,0.6)]';
}

export default function Locks() {
  const { openDrawer, addToast } = useUIStore();
  const [showCreate, setShowCreate] = useState(false);
  const [serial, setSerial] = useState('');
  const [provider, setProvider] = useState('');
  const [firmware, setFirmware] = useState('');
  const [battery, setBattery] = useState('100');
  const { data: lockData, isLoading, isError, isFetching, refetch } = useLocks();
  const createLock = useCreateLock();
  const updateLock = useUpdateLock();

  const locks = (lockData?.data ?? []) as Record<string, unknown>[];

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading e-lock inventory…</div></div>;
  }

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
          <DrawerField label="Tamper status" value={(l['tamper_detected'] === true || l['tamper_detected'] === 'true') ? <span className="text-cds-red">Alert active</span> : 'Normal'} />
        </DrawerSection>
        <DrawerSection title="Assignment">
          <DrawerField label="Container" value={s(l['container_number'])} />
          <DrawerField label="Truck" value={s(l['truck'])} />
        </DrawerSection>
        <div className="flex gap-2 mt-5">
          <Button className="flex-1" disabled title="No hardware ping command is configured in the CDS API; no ping will be sent.">Ping unavailable</Button>
          <Button variant="ghost" className="flex-1" disabled={updateLock.isPending || s(l['status']) === 'maintenance'} onClick={() => updateLock.mutate(
            { id: s(l['id']), status: 'maintenance' },
            { onSuccess: () => addToast('Lock moved to maintenance status'), onError: () => addToast('Maintenance update failed; no change was confirmed', 'error') }
          )}>{s(l['status']) === 'maintenance' ? 'In maintenance' : 'Flag maintenance'}</Button>
        </div>
      </div>
    ));
  };

  const tamperCount = locks.filter((l) => l['tamper_detected'] === true || l['tamper_detected'] === 'true').length;
  const offlineCount = locks.filter((l) => s(l['status']) === 'offline' || s(l['signal_strength']) === 'offline').length;

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="E-Lock Management"
        description={`${lockData?.total ?? locks.length} registered locks · ${tamperCount} tamper alert · ${offlineCount} offline in the loaded inventory`}
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" disabled={isFetching} onClick={() => { void refetch(); }}>{isFetching ? 'Refreshing…' : 'Refresh inventory'}</Button>
            <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>} onClick={() => setShowCreate(value => !value)}>
              {showCreate ? 'Cancel' : 'Register lock'}
            </Button>
          </div>
        }
      />

      {showCreate && (
        <form onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const cleanSerial = serial.trim();
          if (!cleanSerial) { addToast('Lock serial is required', 'error'); return; }
          createLock.mutate({
            serial: cleanSerial,
            provider: provider.trim() || undefined,
            firmware_version: firmware.trim() || undefined,
            status: 'available',
            battery_level: Math.max(0, Math.min(100, Number(battery))),
          }, {
            onSuccess: () => { addToast('E-lock registered'); setShowCreate(false); setSerial(''); setProvider(''); setFirmware(''); setBattery('100'); },
            onError: () => addToast('E-lock registration failed; no change was confirmed', 'error'),
          });
        }} className="mb-4 rounded-xl border border-cds-orange/20 bg-white/[.02] p-4">
          <div className="font-bold text-sm text-text-0 mb-1">Register an e-lock</div>
          <p className="text-[11px] text-text-2 mb-4">This creates an inventory record. Registration does not claim the device is online or paired.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <label className="block"><span className="block text-[10px] uppercase tracking-wider text-text-2 mb-1.5">Serial number *</span><input required maxLength={100} value={serial} onChange={event => setSerial(event.target.value)} className="w-full min-h-[40px] rounded-lg bg-ink-2 border border-white/10 px-3 text-xs text-text-0" /></label>
            <label className="block"><span className="block text-[10px] uppercase tracking-wider text-text-2 mb-1.5">Provider</span><input maxLength={100} value={provider} onChange={event => setProvider(event.target.value)} className="w-full min-h-[40px] rounded-lg bg-ink-2 border border-white/10 px-3 text-xs text-text-0" /></label>
            <label className="block"><span className="block text-[10px] uppercase tracking-wider text-text-2 mb-1.5">Firmware version</span><input maxLength={100} value={firmware} onChange={event => setFirmware(event.target.value)} className="w-full min-h-[40px] rounded-lg bg-ink-2 border border-white/10 px-3 text-xs text-text-0" /></label>
            <label className="block"><span className="block text-[10px] uppercase tracking-wider text-text-2 mb-1.5">Initial battery (%)</span><input type="number" required min="0" max="100" value={battery} onChange={event => setBattery(event.target.value)} className="w-full min-h-[40px] rounded-lg bg-ink-2 border border-white/10 px-3 text-xs text-text-0" /></label>
          </div>
          <div className="flex justify-end gap-2 mt-4"><Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button><Button type="submit" disabled={createLock.isPending}>{createLock.isPending ? 'Registering…' : 'Create lock record'}</Button></div>
        </form>
      )}
      {isError && <div role="alert" className="rounded-lg border border-red-400/20 p-4 text-xs text-red-200">E-lock inventory is unavailable. <button type="button" onClick={() => { void refetch(); }} className="underline ml-2">Retry</button></div>}
      {!isError && locks.length === 0 && <div className="rounded-lg border border-white/[.07] p-8 text-center text-xs text-text-2">No e-lock records are registered for this organisation.</div>}
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
              {(l['tamper_detected'] === true || l['tamper_detected'] === 'true') && (
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
