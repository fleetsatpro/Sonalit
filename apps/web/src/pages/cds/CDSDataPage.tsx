import { useState } from 'react';
import { DataTable, DrawerField, StatusBadge, FilterChip } from './components.js';
import { useContainers, useCDSDrivers, useCDSTransporters } from './hooks.js';
import { useCDSStore } from './store.js';
import { LoadingState } from './CDSDashboard.js';
export { BookingsView } from './CDSBookings.js';

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
          { id: 'num', header: 'Container #', accessor: (r: Row) => <span className="font-mono font-bold text-cds-orange text-xs">{s(r['number'] ?? r['container_number'])}</span> },
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
        onRowClick={(r: Row) => openDrawer(`Container ${s(r['number'] ?? r['container_number'])}`, (
          <>
            <DrawerField label="Container #" value={s(r['number'] ?? r['container_number'])} />
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
