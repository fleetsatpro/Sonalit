import React, { useState } from 'react';
import { Card } from '@/components/ui/Card.js';
import { Button } from '@/components/ui/Button.js';
import { StatusBadge, RiskBadge } from '@/components/ui/Badge.js';
import { FilterChip } from '@/components/ui/DataTable.js';
import { ProgressBar } from '@/components/ui/ProgressBar.js';
import { DrawerField } from '@/components/ui/Drawer.js';
import { useUIStore } from '@/stores/ui.js';

const containers = [
  { id: 'TGHU3456789', status: 'in_transit', truck: 'KDK 456P', driver: 'John Kamau', transporter: 'Kentrans Logistics', commodity: 'Coffee', lock: 'SL23891', origin: 'Nakuru WH', dest: 'Mombasa Port', eta: '18:40', risk: 'low', progress: 64, isoType: '40HC', weight: 24500 },
  { id: 'MSCU7712340', status: 'delivered', truck: 'KBZ 902L', driver: 'Peter Otieno', transporter: 'Swift Cargo', commodity: 'Tea', lock: 'SL23881', origin: 'Kericho WH', dest: 'Mombasa Port', eta: 'Arrived', risk: 'low', progress: 100, isoType: '20GP', weight: 18200 },
  { id: 'CMAU5581223', status: 'delayed', truck: 'KDA 112B', driver: 'Grace Wanjiru', transporter: 'Kentrans Logistics', commodity: 'Cut Flowers', lock: 'SL24410', origin: 'Naivasha WH', dest: 'JKIA Cargo', eta: '21:10 (+2h)', risk: 'high', progress: 41, isoType: '20RF', weight: 12800 },
  { id: 'HLXU9903312', status: 'in_transit', truck: 'KCE 771D', driver: 'Samuel Kiptoo', transporter: 'Rift Transporters', commodity: 'Avocado', lock: 'SL24118', origin: 'Eldoret WH', dest: 'Mombasa Port', eta: '23:05', risk: 'medium', progress: 28, isoType: '40RF', weight: 21000 },
  { id: 'OOCL2261890', status: 'in_transit', truck: 'KDG 330F', driver: 'Alice Njeri', transporter: 'Swift Cargo', commodity: 'Textiles', lock: 'SL23977', origin: 'Thika WH', dest: 'Mombasa Port', eta: '19:50', risk: 'low', progress: 77, isoType: '40GP', weight: 16500 },
  { id: 'MAEU4471029', status: 'pending', truck: '—', driver: '—', transporter: 'Kentrans Logistics', commodity: 'Coffee', lock: 'Unassigned', origin: 'Nyeri WH', dest: 'Mombasa Port', eta: 'Not dispatched', risk: 'low', progress: 0, isoType: '20GP', weight: 0 },
  { id: 'CSNU8834221', status: 'delivered', truck: 'KBW 556J', driver: 'Dennis Mwangi', transporter: 'Rift Transporters', commodity: 'Macadamia', lock: 'SL23652', origin: "Murang'a WH", dest: 'Mombasa Port', eta: 'Arrived', risk: 'low', progress: 100, isoType: '20GP', weight: 19800 },
  { id: 'EGLV1129003', status: 'delayed', truck: 'KDF 887M', driver: 'Faith Chebet', transporter: 'Swift Cargo', commodity: 'Tea', lock: 'SL24290', origin: 'Kericho WH', dest: 'Mombasa Port', eta: '20:30 (+3h)', risk: 'high', progress: 52, isoType: '40HC', weight: 22100 },
];

type Filter = 'all' | 'in_transit' | 'delivered' | 'delayed' | 'pending';

export default function Containers() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const { openDrawer, addToast } = useUIStore();

  const filtered = containers.filter((c) => {
    if (filter !== 'all' && c.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return c.id.toLowerCase().includes(q) || c.truck.toLowerCase().includes(q) || c.driver.toLowerCase().includes(q) || c.commodity.toLowerCase().includes(q);
    }
    return true;
  });

  const openContainerDrawer = (c: typeof containers[0]) => {
    openDrawer(c.id, (
      <div>
        <div className="text-[11px] text-text-2 font-mono mb-4">{c.commodity} · {c.transporter}</div>
        <DrawerField label="Status" value={<StatusBadge status={c.status} />} />
        <DrawerField label="ISO Type" value={c.isoType} />
        <DrawerField label="Weight" value={`${c.weight.toLocaleString()} kg`} />
        <DrawerField label="Truck" value={c.truck} />
        <DrawerField label="Driver" value={c.driver} />
        <DrawerField label="Lock" value={c.lock} />
        <DrawerField label="Origin" value={c.origin} />
        <DrawerField label="Destination" value={c.dest} />
        <DrawerField label="ETA" value={c.eta} />
        <DrawerField label="Risk" value={<RiskBadge risk={c.risk} />} />
        <DrawerField label="Progress" value={`${c.progress}%`} />
        <div className="flex gap-2 mt-4">
          <Button className="flex-1" onClick={() => addToast('Route exported as PDF')}>Export Route PDF</Button>
          <Button variant="ghost" className="flex-1" onClick={() => addToast('AI summary generated')}>AI Summary</Button>
        </div>
      </div>
    ));
  };

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="font-display font-bold text-[17px] m-0">Containers</h2>
          <p className="text-[12px] text-text-2 m-0 mt-1">{containers.length} containers tracked across all active and completed journeys.</p>
        </div>
        <Button icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>}>
          Register Container
        </Button>
      </div>

      <div className="flex items-center gap-2.5 mt-4 mb-4 flex-wrap">
        <FilterChip label={`All (${containers.length})`} active={filter === 'all'} onClick={() => setFilter('all')} />
        <FilterChip label={`In Transit (${containers.filter((c) => c.status === 'in_transit').length})`} active={filter === 'in_transit'} onClick={() => setFilter('in_transit')} />
        <FilterChip label={`Delivered (${containers.filter((c) => c.status === 'delivered').length})`} active={filter === 'delivered'} onClick={() => setFilter('delivered')} />
        <FilterChip label={`Delayed (${containers.filter((c) => c.status === 'delayed').length})`} active={filter === 'delayed'} onClick={() => setFilter('delayed')} />
        <div className="h-[34px] rounded-[9px] bg-ink-2 border border-[rgba(255,255,255,0.07)] flex items-center gap-[7px] px-[11px] text-text-2 text-[12.5px] ml-auto min-w-[220px]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input className="bg-transparent border-none outline-none text-text-0 font-sans flex-1" placeholder="Search container, truck, driver…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {['Container', 'Status', 'Truck / Driver', 'Transporter', 'Commodity', 'Progress', 'Risk', 'ETA'].map((h) => (
                  <th key={h} className="text-left font-mono text-[10px] tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t border-[rgba(255,255,255,0.07)] cursor-pointer hover:bg-ink-2 transition-colors" onClick={() => openContainerDrawer(c)}>
                  <td className="px-3.5 py-3 font-mono text-text-0">{c.id}</td>
                  <td className="px-3.5 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-3.5 py-3 text-text-0">{c.truck}<div className="text-[10.5px] text-text-2 mt-0.5">{c.driver}</div></td>
                  <td className="px-3.5 py-3 text-text-0">{c.transporter}</td>
                  <td className="px-3.5 py-3 text-text-0">{c.commodity}</td>
                  <td className="px-3.5 py-3"><ProgressBar value={c.progress} color={c.status === 'delayed' ? 'bg-cds-red' : 'bg-cds-orange'} /></td>
                  <td className="px-3.5 py-3"><RiskBadge risk={c.risk} /></td>
                  <td className={`px-3.5 py-3 font-mono ${c.status === 'delayed' ? 'text-cds-red' : 'text-text-1'}`}>{c.eta}</td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={8} className="px-3.5 py-8 text-center text-text-2">No containers match.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
