import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Search } from 'lucide-react';
import { DataTable, DrawerField, StatusBadge, FilterChip } from './components.js';
import { useContainers, useCreateContainer, useCDSDrivers, useCDSTransporters } from './hooks.js';
import { useCDSStore } from './store.js';
import { CONTAINER_TYPES } from './constants.js';
import { LoadingState } from './CDSDashboard.js';
export { BookingsView } from './CDSBookings.js';

type Row = Record<string, unknown>;
const s = (v: unknown) => String(v ?? '—');

export function ContainersView() {
  const [filter, setFilter] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [serverSearch, setServerSearch] = useState('');
  const [showRegistration, setShowRegistration] = useState(false);
  const [number, setNumber] = useState('');
  const [isoType, setIsoType] = useState('40HC');
  const [ownership, setOwnership] = useState('leased');
  const [condition, setCondition] = useState('good');
  const [initialStatus, setInitialStatus] = useState('available');
  const [manufacturer, setManufacturer] = useState('');
  const [yearBuilt, setYearBuilt] = useState('');
  const [maxWeight, setMaxWeight] = useState('');
  const [tareWeight, setTareWeight] = useState('');
  useEffect(() => {
    const handle = window.setTimeout(() => setServerSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [searchInput]);
  const { data, isLoading, isError, isFetching, refetch } = useContainers({ query: serverSearch });
  const createContainer = useCreateContainer();
  const { openDrawer, addToast } = useCDSStore();

  if (isLoading) return <LoadingState />;

  const all = (data?.data ?? []) as Row[];
  const rows = filter === 'all' ? all : all.filter(row => row['status'] === filter);
  const statuses = ['all', 'available', 'booked', 'awaiting_pickup', 'in_transit', 'at_port', 'delivered', 'maintenance'];
  const availableCount = all.filter(row => row['status'] === 'available').length;
  const deployedCount = all.filter(row => ['booked', 'awaiting_pickup', 'in_transit', 'at_port'].includes(s(row['status']))).length;
  const reviewCount = all.filter(row => row['status'] === 'maintenance' || ['damaged', 'retired'].includes(s(row['condition']))).length;

  const resetRegistration = () => {
    setNumber('');
    setIsoType('40HC');
    setOwnership('leased');
    setCondition('good');
    setInitialStatus('available');
    setManufacturer('');
    setYearBuilt('');
    setMaxWeight('');
    setTareWeight('');
  };

  const submitRegistration = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanNumber = number.trim().toUpperCase();
    if (!/^[A-Z0-9-]{6,20}$/.test(cleanNumber)) {
      addToast('Enter the exact container identifier using 6–20 letters, numbers or hyphens.', 'error');
      return;
    }
    const built = yearBuilt ? Number(yearBuilt) : null;
    if (built !== null && (!Number.isInteger(built) || built < 1950 || built > new Date().getFullYear() + 1)) {
      addToast('Enter a valid year of manufacture.', 'error');
      return;
    }
    const payload: Record<string, unknown> = {
      number: cleanNumber,
      iso_type: isoType,
      container_type: CONTAINER_TYPES[isoType] ?? isoType,
      container_size: Number.parseInt(isoType, 10) || 20,
      ownership,
      max_weight_kg: maxWeight ? Number(maxWeight) : null,
      tare_weight_kg: tareWeight ? Number(tareWeight) : null,
      manufacturer: manufacturer.trim() || null,
      year_built: built,
      condition,
      status: initialStatus,
    };

    createContainer.mutate(payload, {
      onSuccess: () => {
        addToast('Container registration confirmed.');
        setShowRegistration(false);
        resetRegistration();
      },
      onError: () => {
        addToast('Container registration failed. No successful record was confirmed.', 'error');
      },
    });
  };

  return (
    <div className="p-4 sm:p-6 max-w-[1680px] mx-auto space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="cds-eyebrow">ASSET REGISTER</div>
          <h2 className="text-[21px] sm:text-[24px] font-semibold tracking-tight text-white mt-1">Container inventory</h2>
          <p className="text-[13px] text-slate-300 mt-1">{data?.total ?? all.length} registered container records · custody and condition at a glance.</p>
        </div>
        <button type="button" onClick={() => setShowRegistration(value => !value)} className="cds-secondary-action">
          <Plus size={17} aria-hidden="true" />
          {showRegistration ? 'Close registration' : 'Register container'}
        </button>
      </div>

      {showRegistration && (
        <form onSubmit={submitRegistration} className="cds-registration-panel rounded-2xl border p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-[16px] font-semibold text-white">Register a container</h3>
              <p className="text-[12px] text-slate-300 mt-1">Create a persistent inventory record. Operational movement and lock state are managed through their respective workflows.</p>
            </div>
            <span className="cds-form-note">Required fields marked *</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <label className="cds-form-field">
              <span className="cds-form-label">Container number *</span>
              <input required minLength={6} maxLength={20} autoCapitalize="characters" value={number}
                onChange={event => setNumber(event.target.value.toUpperCase())}
                className="cds-form-control" placeholder="e.g. MSKU1234567" />
              <span className="cds-form-help">Use the exact identifier on the container.</span>
            </label>

            <label className="cds-form-field">
              <span className="cds-form-label">ISO equipment type *</span>
              <select required value={isoType} onChange={event => setIsoType(event.target.value)} className="cds-form-control">
                {Object.entries(CONTAINER_TYPES).map(([code, label]) => <option key={code} value={code}>{code} · {label}</option>)}
              </select>
            </label>

            <label className="cds-form-field">
              <span className="cds-form-label">Ownership *</span>
              <select required value={ownership} onChange={event => setOwnership(event.target.value)} className="cds-form-control">
                <option value="owned">Owned</option>
                <option value="leased">Leased</option>
                <option value="customer">Customer supplied</option>
              </select>
            </label>

            <label className="cds-form-field">
              <span className="cds-form-label">Physical condition *</span>
              <select required value={condition} onChange={event => setCondition(event.target.value)} className="cds-form-control">
                <option value="new">New</option>
                <option value="good">Good</option>
                <option value="fair">Fair</option>
                <option value="damaged">Damaged</option>
                <option value="retired">Retired</option>
              </select>
            </label>

            <label className="cds-form-field">
              <span className="cds-form-label">Initial status *</span>
              <select required value={initialStatus} onChange={event => setInitialStatus(event.target.value)} className="cds-form-control">
                <option value="available">Available</option>
                <option value="maintenance">Maintenance</option>
              </select>
              <span className="cds-form-help">A new record cannot be registered as already in transit or delivered.</span>
            </label>

            <label className="cds-form-field">
              <span className="cds-form-label">Manufacturer</span>
              <input value={manufacturer} onChange={event => setManufacturer(event.target.value)} maxLength={100} className="cds-form-control" placeholder="Manufacturer or builder" />
            </label>

            <label className="cds-form-field">
              <span className="cds-form-label">Year built</span>
              <input type="number" min="1950" max={new Date().getFullYear() + 1} step="1" value={yearBuilt}
                onChange={event => setYearBuilt(event.target.value)} className="cds-form-control" placeholder="YYYY" />
            </label>

            <label className="cds-form-field">
              <span className="cds-form-label">Maximum payload (kg)</span>
              <input type="number" min="0" step="0.01" value={maxWeight} onChange={event => setMaxWeight(event.target.value)} className="cds-form-control" placeholder="Not recorded" />
            </label>

            <label className="cds-form-field">
              <span className="cds-form-label">Tare weight (kg)</span>
              <input type="number" min="0" step="0.01" value={tareWeight} onChange={event => setTareWeight(event.target.value)} className="cds-form-control" placeholder="Not recorded" />
            </label>
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-white/[.08]">
            <button type="button" onClick={() => { setShowRegistration(false); resetRegistration(); }} className="cds-tertiary-action">Cancel</button>
            <button type="submit" disabled={createContainer.isPending} className="cds-form-primary">
              {createContainer.isPending ? 'Registering…' : 'Create container record'}
            </button>
          </div>
        </form>
      )}

      <section className="grid grid-cols-2 xl:grid-cols-4 gap-3" aria-label="Container register summary">
        {[
          { label: 'REGISTERED', value: data?.total ?? all.length, detail: serverSearch ? 'matching records' : 'records in this organisation' },
          { label: 'AVAILABLE', value: availableCount, detail: 'among loaded records' },
          { label: 'IN OPERATIONAL FLOW', value: deployedCount, detail: 'among loaded records' },
          { label: 'REVIEW REQUIRED', value: reviewCount, detail: 'among loaded records' },
        ].map(item => (
          <div key={item.label} className="cds-kpi-panel rounded-xl border px-4 py-3">
            <div className="text-[11px] text-slate-300 font-semibold tracking-[.08em]">{item.label}</div>
            <div className="text-[24px] font-semibold font-mono text-white tabular-nums mt-2">{item.value}</div>
            <div className="text-[12px] text-slate-300 mt-1">{item.detail}</div>
          </div>
        ))}
      </section>

      {(data?.total ?? all.length) > all.length && (
        <p className="cds-register-coverage" role="status">
          Showing the first {all.length} of {data?.total ?? all.length} matching records. Refine the search to locate containers outside this loaded set.
        </p>
      )}

      {isError && (
        <div role="alert" className="cds-data-error rounded-xl border px-4 py-4">
          <div className="text-[14px] font-semibold text-white">Container inventory could not be loaded</div>
          <p className="text-[13px] text-slate-300 mt-1">The register has not been treated as empty. Retry to retrieve the latest records.</p>
          <button type="button" onClick={() => { void refetch(); }} className="cds-secondary-action mt-3">Retry inventory</button>
        </div>
      )}

      <DataTable
        columns={[
          { id: 'num', header: 'Container number', accessor: (r: Row) => <span className="font-mono font-semibold text-cyan-200">{s(r['number'] ?? r['container_number'])}</span>, sortable: true },
          { id: 'type', header: 'Equipment', accessor: (r: Row) => <span className="font-medium text-text-1">{s(r['iso_type'] ?? r['container_type'])}</span>, sortable: true },
          { id: 'owner', header: 'Ownership', accessor: (r: Row) => <span className="capitalize">{s(r['ownership'])}</span>, sortable: true },
          { id: 'condition', header: 'Condition', accessor: (r: Row) => <span className="capitalize">{s(r['condition'] ?? 'Not recorded')}</span>, sortable: true },
          { id: 'status', header: 'Operational status', accessor: (r: Row) => <StatusBadge status={s(r['status'])} />, sortable: true },
          { id: 'loc', header: 'Last recorded location', accessor: (r: Row) => {
            const location = s(r['current_location']);
            if (location !== '—') return location;
            return r['lat'] != null && r['lng'] != null
              ? Number(r['lat']).toFixed(4) + ', ' + Number(r['lng']).toFixed(4)
              : 'Not recorded';
          }},
        ]}
        data={rows}
        keyExtractor={(r: Row) => s(r['id'])}
        searchable={false}
        emptyMessage={all.length === 0 ? 'No container records yet. Register your first container to establish the inventory.' : 'No containers match the selected status.'}
        filters={
          <div className="cds-container-toolbar">
            <div className="flex gap-2 flex-wrap">
              {statuses.map(status => (
                <FilterChip key={status} label={status === 'all' ? 'All containers' : status.replace(/_/g, ' ')} active={filter === status} onClick={() => setFilter(status)} />
              ))}
            </div>
            <label className="cds-container-search">
              <Search size={16} aria-hidden="true" />
              <input
                value={searchInput}
                onChange={event => setSearchInput(event.target.value)}
                aria-label="Search all container records"
                placeholder="Search the full register…"
              />
              {isFetching && <span className="cds-search-indicator">Updating</span>}
            </label>
          </div>
        }
        onRowClick={(r: Row) => openDrawer('Container ' + s(r['number'] ?? r['container_number']), (
          <>
            <DrawerField label="Container number" value={s(r['number'] ?? r['container_number'])} />
            <DrawerField label="ISO equipment type" value={s(r['iso_type'])} />
            <DrawerField label="Ownership" value={s(r['ownership'])} />
            <DrawerField label="Physical condition" value={s(r['condition'] ?? 'Not recorded')} />
            <DrawerField label="Operational status" value={<StatusBadge status={s(r['status'])} />} />
            <DrawerField label="Current location" value={s(r['current_location'])} />
            <DrawerField label="Maximum payload" value={r['max_weight_kg'] ? Number(r['max_weight_kg']).toLocaleString() + ' kg' : 'Not recorded'} />
            <DrawerField label="Tare weight" value={r['tare_weight_kg'] ? Number(r['tare_weight_kg']).toLocaleString() + ' kg' : 'Not recorded'} />
            <DrawerField label="Manufacturer" value={s(r['manufacturer'])} />
            <DrawerField label="Year built" value={s(r['year_built'])} />
            <DrawerField label="Last inspection" value={r['last_inspection'] ? new Date(s(r['last_inspection'])).toLocaleDateString() : 'Not recorded'} />
            <DrawerField label="Next inspection" value={r['next_inspection'] ? new Date(s(r['next_inspection'])).toLocaleDateString() : 'Not recorded'} />
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
