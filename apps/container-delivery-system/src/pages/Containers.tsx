import React, { useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { StatusBadge, RiskBadge } from '@/components/ui/Badge.js';
import { FilterChip } from '@/components/ui/DataTable.js';
import { ProgressBar } from '@/components/ui/ProgressBar.js';
import { DrawerField, DrawerSection } from '@/components/ui/Drawer.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { SearchInput } from '@/components/ui/SearchInput.js';
import { useUIStore } from '@/stores/ui.js';
import { useContainers } from '@/hooks/useContainers.js';

const s = (v: unknown) => String(v ?? '—');

type Filter = 'all' | 'in_transit' | 'delivered' | 'delayed' | 'pending';

export default function Containers() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const { openDrawer, addToast } = useUIStore();
  const { data: containerData, isLoading } = useContainers();

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading…</div></div>;

  const containers = (containerData?.data ?? []) as Record<string, unknown>[];

  const filtered = containers.filter((c) => {
    if (filter !== 'all' && s(c['status']) !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return s(c['number']).toLowerCase().includes(q) || s(c['truck']).toLowerCase().includes(q) || s(c['driver']).toLowerCase().includes(q) || s(c['commodity']).toLowerCase().includes(q);
    }
    return true;
  });

  const openContainerDrawer = (c: Record<string, unknown>) => {
    openDrawer(s(c['number']), (
      <div>
        <div className="text-2xs text-text-2 font-mono mb-4">{s(c['commodity'])} · {s(c['transporter'])}</div>
        <DrawerSection title="Container Info">
          <DrawerField label="Status" value={<StatusBadge status={s(c['status'])} />} />
          <DrawerField label="ISO Type" value={s(c['iso_type'])} />
          <DrawerField label="Weight" value={`${s(c['weight'])} kg`} />
          <DrawerField label="Lock" value={s(c['lock'])} />
        </DrawerSection>
        <DrawerSection title="Transport">
          <DrawerField label="Truck" value={s(c['truck'])} />
          <DrawerField label="Driver" value={s(c['driver'])} />
          <DrawerField label="Origin" value={s(c['origin'])} />
          <DrawerField label="Destination" value={s(c['destination'])} />
          <DrawerField label="ETA" value={s(c['eta'])} />
        </DrawerSection>
        <DrawerSection title="Assessment">
          <DrawerField label="Risk" value={<RiskBadge risk={s(c['risk'])} />} />
          <DrawerField label="Progress" value={<ProgressBar value={Number(c['progress'] ?? 0)} showLabel />} />
        </DrawerSection>
        <div className="flex gap-2 mt-5">
          <Button className="flex-1" onClick={() => addToast('Route exported as PDF')}>Export Route PDF</Button>
          <Button variant="ghost" className="flex-1" onClick={() => addToast('AI summary generated')}>AI Summary</Button>
        </div>
      </div>
    ));
  };

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Containers"
        description={`${containers.length} containers tracked across all active and completed journeys.`}
        actions={
          <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
            Register Container
          </Button>
        }
      />

      <div className="flex items-center gap-2.5 mb-4 flex-wrap">
        <FilterChip label={`All (${containers.length})`} active={filter === 'all'} onClick={() => setFilter('all')} />
        <FilterChip label={`In Transit (${containers.filter((c) => s(c['status']) === 'in_transit').length})`} active={filter === 'in_transit'} onClick={() => setFilter('in_transit')} />
        <FilterChip label={`Delivered (${containers.filter((c) => s(c['status']) === 'delivered').length})`} active={filter === 'delivered'} onClick={() => setFilter('delivered')} />
        <FilterChip label={`Delayed (${containers.filter((c) => s(c['status']) === 'delayed').length})`} active={filter === 'delayed'} onClick={() => setFilter('delayed')} />
        <SearchInput value={search} onChange={setSearch} placeholder="Search container, truck, driver…" className="ml-auto" />
      </div>

      <div className="glass p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs-tight">
            <thead>
              <tr>
                {['Container', 'Status', 'Truck / Driver', 'Transporter', 'Commodity', 'Progress', 'Risk', 'ETA'].map((h) => (
                  <th key={h} className="text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr key={s(c['number'] ?? i)} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors" onClick={() => openContainerDrawer(c)}>
                  <td className="px-3.5 py-3 font-mono text-text-0">{s(c['number'])}</td>
                  <td className="px-3.5 py-3"><StatusBadge status={s(c['status'])} /></td>
                  <td className="px-3.5 py-3 text-text-0">{s(c['truck'])}<div className="text-2xs text-text-2 mt-0.5">{s(c['driver'])}</div></td>
                  <td className="px-3.5 py-3 text-text-0">{s(c['transporter'])}</td>
                  <td className="px-3.5 py-3 text-text-0">{s(c['commodity'])}</td>
                  <td className="px-3.5 py-3"><ProgressBar value={Number(c['progress'] ?? 0)} color={s(c['status']) === 'delayed' ? 'bg-cds-red' : 'bg-cds-orange'} /></td>
                  <td className="px-3.5 py-3"><RiskBadge risk={s(c['risk'])} /></td>
                  <td className={`px-3.5 py-3 font-mono ${s(c['status']) === 'delayed' ? 'text-cds-red' : 'text-text-1'}`}>{s(c['eta'])}</td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={8} className="px-3.5 py-8 text-center text-text-2">No containers match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
