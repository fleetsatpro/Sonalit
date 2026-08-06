import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { DataTable, DrawerField, StatusBadge, FilterChip } from './components.js';
import { useContainers, useBookings, useCreateBooking, useCDSDrivers, useCDSTransporters } from './hooks.js';
import { useCDSStore } from './store.js';
import { LoadingState } from './CDSDashboard.js';

type Row = Record<string, unknown>;
const s = (v: unknown) => String(v ?? '—');

export function ContainersView() {
  const [filter, setFilter] = useState('all');
  const { data, isLoading } = useContainers();
  const { openDrawer } = useCDSStore();
  if (isLoading) return <LoadingState />;

  const all = (data?.data ?? []) as Row[];
  const rows = filter === 'all' ? all : all.filter(r => r['status'] === filter);
  const statuses = ['all', 'available', 'assigned', 'in_transit', 'at_port', 'delivered', 'maintenance'];

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <DataTable
        columns={[
          { id: 'num', header: 'Container #', accessor: (r: Row) => <span className="font-mono font-bold text-cds-orange text-xs">{s(r['container_number'])}</span> },
          { id: 'type', header: 'Type', accessor: (r: Row) => <span className="font-mono text-xs">{s(r['iso_type'])}</span> },
          { id: 'owner', header: 'Ownership', accessor: (r: Row) => s(r['ownership']) },
          { id: 'status', header: 'Status', accessor: (r: Row) => <StatusBadge status={s(r['status'])} /> },
          { id: 'loc', header: 'Location', accessor: (r: Row) => r['lat'] ? `${Number(r['lat']).toFixed(4)}, ${Number(r['lng']).toFixed(4)}` : '—' },
        ]}
        data={rows}
        keyExtractor={(r: Row) => s(r['id'])}
        searchable
        searchPlaceholder="Search containers…"
        filters={
          <div className="flex gap-1 flex-wrap">
            {statuses.map(st => (
              <FilterChip key={st} label={st === 'all' ? 'All' : st.replace('_', ' ').toUpperCase()} active={filter === st} onClick={() => setFilter(st)} />
            ))}
          </div>
        }
        onRowClick={(r: Row) => openDrawer(`Container ${s(r['container_number'])}`, (
          <>
            <DrawerField label="Container #" value={s(r['container_number'])} />
            <DrawerField label="ISO Type" value={s(r['iso_type'])} />
            <DrawerField label="Ownership" value={s(r['ownership'])} />
            <DrawerField label="Status" value={<StatusBadge status={s(r['status'])} />} />
            <DrawerField label="Max Weight" value={r['max_weight'] ? `${r['max_weight']} kg` : '—'} />
            <DrawerField label="Tare Weight" value={r['tare_weight'] ? `${r['tare_weight']} kg` : '—'} />
            <DrawerField label="Manufacturer" value={s(r['manufacturer'])} />
            <DrawerField label="Year Built" value={s(r['year_built'])} />
            <DrawerField label="Last Inspection" value={r['last_inspection'] ? new Date(s(r['last_inspection'])).toLocaleDateString() : '—'} />
          </>
        ))}
      />
    </div>
  );
}

const BOOKING_FIELDS: { key: string; label: string; type?: string; required?: boolean; placeholder?: string }[] = [
  { key: 'reference', label: 'Reference', required: true, placeholder: 'e.g. PO-2026-001' },
  { key: 'pickup_location', label: 'Pickup Location', required: true, placeholder: 'e.g. Mombasa Port' },
  { key: 'delivery_location', label: 'Delivery Location', required: true, placeholder: 'e.g. Nairobi ICD' },
  { key: 'commodity', label: 'Commodity', required: true, placeholder: 'e.g. Tea, Electronics' },
  { key: 'weight_kg', label: 'Weight (kg)', type: 'number', placeholder: '0' },
  { key: 'container_type', label: 'Container Type', placeholder: 'e.g. 20GP, 40HC' },
  { key: 'container_size', label: 'Container Size', placeholder: 'e.g. 20ft, 40ft' },
  { key: 'shipping_line', label: 'Shipping Line', placeholder: 'e.g. Maersk, MSC' },
  { key: 'vessel', label: 'Vessel', placeholder: 'Vessel name' },
  { key: 'voyage', label: 'Voyage', placeholder: 'Voyage number' },
  { key: 'seal_number', label: 'Seal Number', placeholder: 'Seal #' },
  { key: 'eta', label: 'ETA', type: 'date' },
  { key: 'notes', label: 'Notes', placeholder: 'Additional notes...' },
];

export function BookingsView() {
  const { data, isLoading } = useBookings();
  const { openDrawer } = useCDSStore();
  const createBooking = useCreateBooking();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  if (isLoading) return <LoadingState />;
  const rows = (data?.data ?? []) as Row[];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {};
    for (const f of BOOKING_FIELDS) {
      const val = form[f.key];
      if (val) payload[f.key] = f.type === 'number' ? Number(val) : val;
    }
    createBooking.mutate(payload, {
      onSuccess: () => { setShowForm(false); setForm({}); },
    });
  };

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-text-0">Bookings</h2>
          <p className="text-[11px] text-text-2 font-mono mt-0.5">{rows.length} total bookings</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-3.5 h-9 rounded-lg text-[12px] font-semibold border-none cursor-pointer transition-all hover:brightness-110"
          style={{ background: 'linear-gradient(135deg, #ff7a00, #F0B429)', color: '#0c0e12' }}
        >
          <Plus size={15} strokeWidth={2.5} />
          New Booking
        </button>
      </div>
      <DataTable
        columns={[
          { id: 'num', header: 'Booking #', accessor: (r: Row) => <span className="font-mono font-bold text-cds-orange text-xs">{s(r['booking_number'])}</span> },
          { id: 'ref', header: 'Reference', accessor: (r: Row) => <span className="font-mono text-xs">{s(r['reference'])}</span> },
          { id: 'customer', header: 'Customer', accessor: (r: Row) => s(r['customer_name']) },
          { id: 'status', header: 'Status', accessor: (r: Row) => <StatusBadge status={s(r['status'])} /> },
          { id: 'pickup', header: 'Pickup', accessor: (r: Row) => s(r['pickup_location']) },
          { id: 'delivery', header: 'Delivery', accessor: (r: Row) => s(r['delivery_location']) },
          { id: 'commodity', header: 'Commodity', accessor: (r: Row) => s(r['commodity']) },
          { id: 'eta', header: 'ETA', accessor: (r: Row) => r['eta'] ? new Date(s(r['eta'])).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—' },
        ]}
        data={rows}
        keyExtractor={(r: Row) => s(r['id'])}
        searchable
        searchPlaceholder="Search bookings…"
        onRowClick={(r: Row) => openDrawer(`Booking ${s(r['booking_number'])}`, (
          <>
            <DrawerField label="Booking #" value={s(r['booking_number'])} />
            <DrawerField label="Reference" value={s(r['reference'])} />
            <DrawerField label="Customer" value={s(r['customer_name'])} />
            <DrawerField label="Status" value={<StatusBadge status={s(r['status'])} />} />
            <DrawerField label="Pickup" value={s(r['pickup_location'])} />
            <DrawerField label="Delivery" value={s(r['delivery_location'])} />
            <DrawerField label="Commodity" value={s(r['commodity'])} />
            <DrawerField label="Container" value={`${s(r['container_size'])} ${s(r['container_type'])}`.trim() || '—'} />
            <DrawerField label="Shipping Line" value={s(r['shipping_line'])} />
            <DrawerField label="ETA" value={r['eta'] ? new Date(s(r['eta'])).toLocaleDateString() : '—'} />
          </>
        ))}
      />

      {/* New Booking Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-lg mx-4 rounded-2xl border border-white/[.08] bg-[#12141a] shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[.06]">
              <div>
                <h3 className="text-[15px] font-bold text-white">New Booking</h3>
                <p className="text-[10px] text-white/40 font-mono mt-0.5">Fill in the shipment details</p>
              </div>
              <button type="button" onClick={() => setShowForm(false)} className="w-8 h-8 rounded-lg bg-white/[.04] border border-white/[.06] text-white/40 hover:text-white/70 flex items-center justify-center cursor-pointer transition-colors">
                <X size={15} />
              </button>
            </div>
            <div className="px-5 py-4 max-h-[60vh] overflow-y-auto space-y-3">
              {BOOKING_FIELDS.map(f => (
                <div key={f.key}>
                  <label className="block text-[11px] font-medium text-white/50 mb-1">
                    {f.label}{f.required && <span className="text-cds-orange ml-0.5">*</span>}
                  </label>
                  <input
                    type={f.type ?? 'text'}
                    required={f.required}
                    placeholder={f.placeholder}
                    value={form[f.key] ?? ''}
                    onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="w-full h-9 px-3 rounded-lg bg-white/[.04] border border-white/[.08] text-white text-[13px] outline-none focus:border-[#F0B429]/50 transition-colors placeholder:text-white/20"
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/[.06]">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 h-9 rounded-lg text-[12px] font-medium text-white/50 bg-white/[.04] border border-white/[.06] cursor-pointer hover:text-white/70 transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={createBooking.isPending}
                className="px-5 h-9 rounded-lg text-[12px] font-semibold border-none cursor-pointer transition-all hover:brightness-110 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #ff7a00, #F0B429)', color: '#0c0e12' }}
              >
                {createBooking.isPending ? 'Creating...' : 'Create Booking'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export function DriversView() {
  const { data, isLoading } = useCDSDrivers();
  const { openDrawer } = useCDSStore();
  if (isLoading) return <LoadingState />;
  const rows = (data?.data ?? []) as Row[];

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <DataTable
        columns={[
          { id: 'name', header: 'Name', accessor: (r: Row) => <span className="font-semibold text-text-0">{s(r['name'])}</span> },
          { id: 'phone', header: 'Phone', accessor: (r: Row) => <span className="font-mono text-xs">{s(r['phone'])}</span> },
          { id: 'license', header: 'License', accessor: (r: Row) => <span className="font-mono text-xs">{s(r['license_number'])}</span> },
          { id: 'status', header: 'Status', accessor: (r: Row) => <StatusBadge status={s(r['status'])} /> },
          { id: 'trips', header: 'Total Trips', accessor: (r: Row) => s(r['total_trips']) },
          { id: 'rating', header: 'Rating', accessor: (r: Row) => {
            const rating = Number(r['rating'] ?? 0);
            return (
              <div className="flex items-center gap-1.5">
                <div className="w-[50px] h-1.5 rounded bg-ink-3 overflow-hidden">
                  <div className="h-full rounded bg-cds-teal" style={{ width: `${(rating / 5) * 100}%` }} />
                </div>
                <span className="text-[10px] font-mono text-text-2">{rating.toFixed(1)}</span>
              </div>
            );
          }},
        ]}
        data={rows}
        keyExtractor={(r: Row) => s(r['id'])}
        searchable
        searchPlaceholder="Search drivers…"
        onRowClick={(r: Row) => openDrawer(`Driver — ${s(r['name'])}`, (
          <>
            <DrawerField label="Name" value={s(r['name'])} />
            <DrawerField label="Phone" value={s(r['phone'])} />
            <DrawerField label="Email" value={s(r['email'])} />
            <DrawerField label="License" value={s(r['license_number'])} />
            <DrawerField label="License Expiry" value={r['license_expiry'] ? new Date(s(r['license_expiry'])).toLocaleDateString() : '—'} />
            <DrawerField label="Status" value={<StatusBadge status={s(r['status'])} />} />
            <DrawerField label="Total Trips" value={s(r['total_trips'])} />
            <DrawerField label="Rating" value={`${Number(r['rating'] ?? 0).toFixed(1)} / 5.0`} />
          </>
        ))}
      />
    </div>
  );
}

export function TransportersView() {
  const { data, isLoading } = useCDSTransporters();
  const { openDrawer } = useCDSStore();
  if (isLoading) return <LoadingState />;
  const rows = (data?.data ?? []) as Row[];

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <DataTable
        columns={[
          { id: 'name', header: 'Company', accessor: (r: Row) => <span className="font-semibold text-text-0">{s(r['company_name'])}</span> },
          { id: 'code', header: 'Code', accessor: (r: Row) => <span className="font-mono text-xs">{s(r['code'])}</span> },
          { id: 'contact', header: 'Contact', accessor: (r: Row) => s(r['contact_person']) },
          { id: 'phone', header: 'Phone', accessor: (r: Row) => <span className="font-mono text-xs">{s(r['phone'])}</span> },
          { id: 'trucks', header: 'Trucks', accessor: (r: Row) => s(r['total_trucks']) },
          { id: 'ontime', header: 'On-Time', accessor: (r: Row) => {
            const rate = Number(r['on_time_rate'] ?? 0);
            const color = rate >= 90 ? '#33d6a8' : rate >= 70 ? '#ffb020' : '#ff5c5c';
            return <span className="font-mono text-xs" style={{ color }}>{rate}%</span>;
          }},
          { id: 'status', header: 'Status', accessor: (r: Row) => <StatusBadge status={s(r['status'])} /> },
          { id: 'rating', header: 'Rating', accessor: (r: Row) => {
            const rating = Number(r['rating'] ?? 0);
            return <span className="font-mono text-xs text-text-1">{rating.toFixed(1)}</span>;
          }},
        ]}
        data={rows}
        keyExtractor={(r: Row) => s(r['id'])}
        searchable
        searchPlaceholder="Search transporters…"
        onRowClick={(r: Row) => openDrawer(`Transporter — ${s(r['company_name'])}`, (
          <>
            <DrawerField label="Company" value={s(r['company_name'])} />
            <DrawerField label="Code" value={s(r['code'])} />
            <DrawerField label="Contact" value={s(r['contact_person'])} />
            <DrawerField label="Phone" value={s(r['phone'])} />
            <DrawerField label="Email" value={s(r['email'])} />
            <DrawerField label="Total Trucks" value={s(r['total_trucks'])} />
            <DrawerField label="On-Time Rate" value={`${Number(r['on_time_rate'] ?? 0)}%`} />
            <DrawerField label="Total Trips" value={s(r['total_trips'])} />
            <DrawerField label="Rating" value={`${Number(r['rating'] ?? 0).toFixed(1)} / 5.0`} />
            <DrawerField label="Status" value={<StatusBadge status={s(r['status'])} />} />
          </>
        ))}
      />
    </div>
  );
}
