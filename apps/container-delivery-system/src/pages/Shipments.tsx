import React, { useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { StatusBadge, RiskBadge } from '@/components/ui/Badge.js';
import { FilterChip } from '@/components/ui/DataTable.js';
import { ProgressBar } from '@/components/ui/ProgressBar.js';
import { DrawerField, DrawerSection } from '@/components/ui/Drawer.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { SearchInput } from '@/components/ui/SearchInput.js';
import { useUIStore } from '@/stores/ui.js';
import { useShipments } from '@/hooks/useShipments.js';

const s = (v: unknown) => String(v ?? '—');

type Filter = 'all' | 'in_transit' | 'delivered' | 'created' | 'closed';

export default function Shipments() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const { openDrawer, addToast } = useUIStore();
  const { data: shipmentData, isLoading } = useShipments();

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading…</div></div>;

  const shipments = (shipmentData?.data ?? []) as Record<string, unknown>[];

  const filtered = shipments.filter((row) => {
    if (filter !== 'all' && s(row['status']) !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return s(row['id']).toLowerCase().includes(q) || s(row['reference']).toLowerCase().includes(q) || s(row['customer']).toLowerCase().includes(q) || s(row['container']).toLowerCase().includes(q) || s(row['driver']).toLowerCase().includes(q);
    }
    return true;
  });

  const openShipmentDrawer = (row: Record<string, unknown>) => {
    openDrawer(s(row['id']), (
      <div>
        <div className="text-2xs text-text-2 font-mono mb-4">{s(row['commodity'])} · {s(row['transporter'])}</div>
        <DrawerSection title="Shipment Details">
          <DrawerField label="Status" value={<StatusBadge status={s(row['status'])} />} />
          <DrawerField label="Customer" value={s(row['customer'])} />
          <DrawerField label="Container" value={s(row['container'])} />
          <DrawerField label="Vehicle" value={s(row['vehicle'])} />
          <DrawerField label="Driver" value={s(row['driver'])} />
          <DrawerField label="Lock" value={s(row['lock'])} />
        </DrawerSection>
        <DrawerSection title="Route">
          <DrawerField label="Booking Ref" value={s(row['booking_ref'])} />
          <DrawerField label="Seal Number" value={s(row['seal_number'])} />
          <DrawerField label="Origin" value={s(row['origin'])} />
          <DrawerField label="Destination" value={s(row['destination'])} />
          <DrawerField label="ETA" value={s(row['eta'])} />
          <DrawerField label="Risk" value={<RiskBadge risk={s(row['risk'])} />} />
          <DrawerField label="Progress" value={<ProgressBar value={Number(row['progress'] ?? 0)} showLabel />} />
        </DrawerSection>
        <div className="flex gap-2 mt-5">
          <Button className="flex-1" onClick={() => addToast('Route exported as PDF')}>Export PDF</Button>
          <Button variant="ghost" className="flex-1" onClick={() => addToast('AI summary generated')}>AI Summary</Button>
        </div>
      </div>
    ));
  };

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <PageHeader
        title="Shipments"
        description={`${shipments.length} shipments across all stages of the delivery lifecycle.`}
        actions={
          <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
            New Shipment
          </Button>
        }
      />

      <div className="flex items-center gap-2.5 mb-4 flex-wrap">
        <FilterChip label={`All (${shipments.length})`} active={filter === 'all'} onClick={() => setFilter('all')} />
        <FilterChip label={`In Transit (${shipments.filter((row) => s(row['status']) === 'in_transit').length})`} active={filter === 'in_transit'} onClick={() => setFilter('in_transit')} />
        <FilterChip label={`Delivered (${shipments.filter((row) => s(row['status']) === 'delivered').length})`} active={filter === 'delivered'} onClick={() => setFilter('delivered')} />
        <FilterChip label={`Created (${shipments.filter((row) => s(row['status']) === 'created').length})`} active={filter === 'created'} onClick={() => setFilter('created')} />
        <SearchInput value={search} onChange={setSearch} placeholder="Search shipments…" className="ml-auto" />
      </div>

      <div className="glass p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs-tight">
            <thead>
              <tr>
                {['Shipment', 'Status', 'Customer', 'Container', 'Vehicle / Driver', 'Commodity', 'Progress', 'Risk', 'ETA'].map((h) => (
                  <th key={h} className="text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={s(row['id'] ?? i)} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors" onClick={() => openShipmentDrawer(row)}>
                  <td className="px-3.5 py-3 font-mono text-text-0">{s(row['id'])}<div className="text-2xs text-text-2 mt-0.5">{s(row['reference'])}</div></td>
                  <td className="px-3.5 py-3"><StatusBadge status={s(row['status'])} /></td>
                  <td className="px-3.5 py-3 text-text-0">{s(row['customer'])}</td>
                  <td className="px-3.5 py-3 font-mono text-text-0">{s(row['container'])}</td>
                  <td className="px-3.5 py-3 text-text-0">{s(row['vehicle'])}<div className="text-2xs text-text-2 mt-0.5">{s(row['driver'])}</div></td>
                  <td className="px-3.5 py-3 text-text-0">{s(row['commodity'])}</td>
                  <td className="px-3.5 py-3"><ProgressBar value={Number(row['progress'] ?? 0)} color={s(row['risk']) === 'high' ? 'bg-cds-red' : 'bg-cds-orange'} /></td>
                  <td className="px-3.5 py-3"><RiskBadge risk={s(row['risk'])} /></td>
                  <td className={`px-3.5 py-3 font-mono ${s(row['risk']) === 'high' ? 'text-cds-red' : 'text-text-1'}`}>{s(row['eta'])}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="px-3.5 py-8 text-center text-text-2">No shipments match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
