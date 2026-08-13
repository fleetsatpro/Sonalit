import React, { useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { StatusBadge, RiskBadge } from '@/components/ui/Badge.js';
import { FilterChip } from '@/components/ui/DataTable.js';
import { ProgressBar } from '@/components/ui/ProgressBar.js';
import { DrawerField, DrawerSection } from '@/components/ui/Drawer.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { SearchInput } from '@/components/ui/SearchInput.js';
import { useUIStore } from '@/stores/ui.js';
import type { ShipmentStatus } from '@/types/index.js';

const shipments = [
  { id: 'SHP-2026-001', reference: 'MSC56789', status: 'in_transit' as ShipmentStatus, customer: 'Kenya Coffee Board', container: 'TGHU3456789', vehicle: 'KDK 456P', driver: 'John Kamau', transporter: 'Kentrans Logistics', commodity: 'Coffee', lock: 'SL23891', origin: 'Nakuru WH', destination: 'Mombasa Port', eta: '18:40', risk: 'low', progress: 64, bookingRef: 'MSC56789', sealNumber: 'SN-88213' },
  { id: 'SHP-2026-002', reference: 'MSC56790', status: 'delivered' as ShipmentStatus, customer: 'KTDA Holdings', container: 'MSCU7712340', vehicle: 'KBZ 902L', driver: 'Peter Otieno', transporter: 'Swift Cargo', commodity: 'Tea', lock: 'SL23881', origin: 'Kericho WH', destination: 'Mombasa Port', eta: 'Arrived', risk: 'low', progress: 100, bookingRef: 'MSC56790', sealNumber: 'SN-88214' },
  { id: 'SHP-2026-003', reference: 'MSC56791', status: 'in_transit' as ShipmentStatus, customer: 'Sian Roses', container: 'CMAU5581223', vehicle: 'KDA 112B', driver: 'Grace Wanjiru', transporter: 'Kentrans Logistics', commodity: 'Cut Flowers', lock: 'SL24410', origin: 'Naivasha WH', destination: 'JKIA Cargo', eta: '21:10 (+2h)', risk: 'high', progress: 41, bookingRef: 'MSC56791', sealNumber: 'SN-88215' },
  { id: 'SHP-2026-004', reference: 'MSC56792', status: 'in_transit' as ShipmentStatus, customer: 'Kakuzi PLC', container: 'HLXU9903312', vehicle: 'KCE 771D', driver: 'Samuel Kiptoo', transporter: 'Rift Transporters', commodity: 'Avocado', lock: 'SL24118', origin: 'Eldoret WH', destination: 'Mombasa Port', eta: '23:05', risk: 'medium', progress: 28, bookingRef: 'MSC56792', sealNumber: 'SN-88216' },
  { id: 'SHP-2026-005', reference: 'MSC56793', status: 'in_transit' as ShipmentStatus, customer: 'EPZ Textiles', container: 'OOCL2261890', vehicle: 'KDG 330F', driver: 'Alice Njeri', transporter: 'Swift Cargo', commodity: 'Textiles', lock: 'SL23977', origin: 'Thika WH', destination: 'Mombasa Port', eta: '19:50', risk: 'low', progress: 77, bookingRef: 'MSC56793', sealNumber: 'SN-88217' },
  { id: 'SHP-2026-006', reference: 'MSC56794', status: 'created' as ShipmentStatus, customer: 'Kenya Coffee Board', container: null, vehicle: null, driver: null, transporter: 'Kentrans Logistics', commodity: 'Coffee', lock: null, origin: 'Nyeri WH', destination: 'Mombasa Port', eta: 'Not dispatched', risk: 'low', progress: 0, bookingRef: 'MSC56794', sealNumber: null },
  { id: 'SHP-2026-007', reference: 'MSC56795', status: 'closed' as ShipmentStatus, customer: 'Sasini PLC', container: 'CSNU8834221', vehicle: 'KBW 556J', driver: 'Dennis Mwangi', transporter: 'Rift Transporters', commodity: 'Macadamia', lock: 'SL23652', origin: "Murang'a WH", destination: 'Mombasa Port', eta: 'Arrived', risk: 'low', progress: 100, bookingRef: 'MSC56795', sealNumber: 'SN-88219' },
  { id: 'SHP-2026-008', reference: 'MSC56796', status: 'in_transit' as ShipmentStatus, customer: 'KTDA Holdings', container: 'EGLV1129003', vehicle: 'KDF 887M', driver: 'Faith Chebet', transporter: 'Swift Cargo', commodity: 'Tea', lock: 'SL24290', origin: 'Kericho WH', destination: 'Mombasa Port', eta: '20:30 (+3h)', risk: 'high', progress: 52, bookingRef: 'MSC56796', sealNumber: 'SN-88220' },
];

type Filter = 'all' | 'in_transit' | 'delivered' | 'created' | 'closed';

export default function Shipments() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const { openDrawer, addToast } = useUIStore();

  const filtered = shipments.filter((s) => {
    if (filter !== 'all' && s.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.id.toLowerCase().includes(q) || s.reference.toLowerCase().includes(q) || s.customer.toLowerCase().includes(q) || (s.container?.toLowerCase().includes(q) ?? false) || (s.driver?.toLowerCase().includes(q) ?? false);
    }
    return true;
  });

  const openShipmentDrawer = (s: typeof shipments[0]) => {
    openDrawer(s.id, (
      <div>
        <div className="text-2xs text-text-2 font-mono mb-4">{s.commodity} · {s.transporter}</div>
        <DrawerSection title="Shipment Details">
          <DrawerField label="Status" value={<StatusBadge status={s.status} />} />
          <DrawerField label="Customer" value={s.customer} />
          <DrawerField label="Container" value={s.container ?? '—'} />
          <DrawerField label="Vehicle" value={s.vehicle ?? '—'} />
          <DrawerField label="Driver" value={s.driver ?? '—'} />
          <DrawerField label="Lock" value={s.lock ?? '—'} />
        </DrawerSection>
        <DrawerSection title="Route">
          <DrawerField label="Booking Ref" value={s.bookingRef} />
          <DrawerField label="Seal Number" value={s.sealNumber ?? '—'} />
          <DrawerField label="Origin" value={s.origin} />
          <DrawerField label="Destination" value={s.destination} />
          <DrawerField label="ETA" value={s.eta} />
          <DrawerField label="Risk" value={<RiskBadge risk={s.risk} />} />
          <DrawerField label="Progress" value={<ProgressBar value={s.progress} showLabel />} />
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
        <FilterChip label={`In Transit (${shipments.filter((s) => s.status === 'in_transit').length})`} active={filter === 'in_transit'} onClick={() => setFilter('in_transit')} />
        <FilterChip label={`Delivered (${shipments.filter((s) => s.status === 'delivered').length})`} active={filter === 'delivered'} onClick={() => setFilter('delivered')} />
        <FilterChip label={`Created (${shipments.filter((s) => s.status === 'created').length})`} active={filter === 'created'} onClick={() => setFilter('created')} />
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
              {filtered.map((s) => (
                <tr key={s.id} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors" onClick={() => openShipmentDrawer(s)}>
                  <td className="px-3.5 py-3 font-mono text-text-0">{s.id}<div className="text-2xs text-text-2 mt-0.5">{s.reference}</div></td>
                  <td className="px-3.5 py-3"><StatusBadge status={s.status} /></td>
                  <td className="px-3.5 py-3 text-text-0">{s.customer}</td>
                  <td className="px-3.5 py-3 font-mono text-text-0">{s.container ?? '—'}</td>
                  <td className="px-3.5 py-3 text-text-0">{s.vehicle ?? '—'}<div className="text-2xs text-text-2 mt-0.5">{s.driver ?? '—'}</div></td>
                  <td className="px-3.5 py-3 text-text-0">{s.commodity}</td>
                  <td className="px-3.5 py-3"><ProgressBar value={s.progress} color={s.risk === 'high' ? 'bg-cds-red' : 'bg-cds-orange'} /></td>
                  <td className="px-3.5 py-3"><RiskBadge risk={s.risk} /></td>
                  <td className={`px-3.5 py-3 font-mono ${s.risk === 'high' ? 'text-cds-red' : 'text-text-1'}`}>{s.eta}</td>
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
