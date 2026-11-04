import { useEffect, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import { DataTable, DrawerField, StatusBadge, FilterChip } from './components.js';
import { useContainers, useCreateContainer, useCDSDrivers, useCDSTransporters } from './hooks.js';
import { useCDSStore } from './store.js';
import { CONTAINER_TYPES } from './constants.js';
import { LoadingState } from './CDSDashboard.js';
export { BookingsView } from './CDSBookings.js';

type Row = Record<string, unknown>;
const s = (v: unknown) => String(v ?? '—');

const ISO_6346_LETTER_VALUES: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19,
  J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29,
  S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

function isValidISO6346FreightContainerNumber(value: string): boolean {
  if (!/^[A-Z]{3}U[0-9]{7}$/.test(value)) return false;
  const identifier = value.slice(0, 10);
  let weightedTotal = 0;
  for (let index = 0; index < identifier.length; index += 1) {
    const character = identifier[index];
    const numericValue = /[0-9]/.test(character)
      ? Number(character)
      : ISO_6346_LETTER_VALUES[character];
    if (!Number.isFinite(numericValue)) return false;
    weightedTotal += numericValue * (2 ** index);
  }
  const remainder = weightedTotal % 11;
  const expectedCheckDigit = remainder === 10 ? '0' : String(remainder);
  return value[10] === expectedCheckDigit;
}

export function ContainersView() {
  const [filter, setFilter] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [serverSearch, setServerSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
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
    const handle = window.setTimeout(() => {
      setServerSearch(searchInput.trim());
      setPage(0);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [searchInput]);
  const { data, isLoading, isError, isFetching, refetch } = useContainers({
    query: serverSearch,
    status: filter === 'all' ? undefined : filter,
    limit: pageSize,
    offset: page * pageSize,
  });
  const createContainer = useCreateContainer();
  const { openDrawer, addToast } = useCDSStore();

  if (isLoading) return <LoadingState />;

  const rows = (data?.data ?? []) as Row[];
  const summary = data?.summary;
  const statuses = ['all', 'available', 'booked', 'awaiting_pickup', 'in_transit', 'at_port', 'delivered', 'maintenance'];
  const total = Number(data?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = Math.min((page + 1) * pageSize, total);

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
    if (!isValidISO6346FreightContainerNumber(cleanNumber)) {
      addToast('Enter a valid ISO 6346 freight-container number: three owner-code letters, U, six serial digits and the correct check digit. The owner code is not checked against the BIC registry.', 'error');
      return;
    }
    const built = yearBuilt ? Number(yearBuilt) : null;
    if (built !== null && (!Number.isInteger(built) || built < 1950 || built > new Date().getFullYear() + 1)) {
      addToast('Enter a valid year of manufacture.', 'error');
      return;
    }
    const maxPayload = maxWeight ? Number(maxWeight) : null;
    const tare = tareWeight ? Number(tareWeight) : null;
    if ([maxPayload, tare].some(value => value !== null && (!Number.isFinite(value) || value <= 0))) {
      addToast('Weight values must be positive numbers when supplied.', 'error');
      return;
    }
    if (['damaged', 'retired'].includes(condition) && initialStatus !== 'maintenance') {
      addToast('Damaged or retired containers must begin in maintenance status.', 'error');
      return;
    }
    const payload: Record<string, unknown> = {
      number: cleanNumber,
      iso_type: isoType,
      container_type: CONTAINER_TYPES[isoType] ?? isoType,
      container_size: Number.parseInt(isoType, 10) || 20,
      ownership,
      max_weight_kg: maxPayload,
      tare_weight_kg: tare,
      manufacturer: manufacturer.trim() || null,
      year_built: built,
      condition,
      status: initialStatus,
    };

    createContainer.mutate(payload, {
      onSuccess: () => {
        addToast('Container registration confirmed and audited.');
        setShowRegistration(false);
        resetRegistration();
        setSearchInput('');
        setServerSearch('');
        setFilter('all');
        setPage(0);
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
          <p className="text-[13px] text-slate-300 mt-1">{isError && !data ? 'Inventory count unavailable' : (summary?.registered ?? '—') + ' registered container records'} · custody and condition at a glance.</p>
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
              <input required minLength={11} maxLength={11} pattern="[A-Z]{3}U[0-9]{7}" autoCapitalize="characters" autoComplete="off" spellCheck={false} value={number}
                onChange={event => setNumber(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))}
                className="cds-form-control" placeholder="e.g. MSKU1234565" />
              <span className="cds-form-help">ISO 6346 check digit is validated. BIC owner-code registration is not verified.</span>
            </label>

            <label className="cds-form-field">
              <span className="cds-form-label">Equipment type *</span>
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
              <select required value={condition} onChange={event => {
                  const next = event.target.value;
                  setCondition(next);
                  if (['damaged', 'retired'].includes(next)) setInitialStatus('maintenance');
                }} className="cds-form-control">
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
                <option value="available" disabled={condition === 'damaged' || condition === 'retired'}>Available</option>
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
          { label: 'REGISTERED', value: isError && !data ? '—' : summary?.registered ?? '—', detail: 'in this organisation' },
          { label: 'AVAILABLE', value: isError && !data ? '—' : summary?.available ?? '—', detail: 'ready for allocation' },
          { label: 'IN OPERATIONAL FLOW', value: isError && !data ? '—' : summary?.in_operational_flow ?? '—', detail: 'booked, picked up or moving' },
          { label: 'REVIEW REQUIRED', value: isError && !data ? '—' : summary?.review_required ?? '—', detail: 'maintenance or condition review' },
        ].map(item => (
          <div key={item.label} className="cds-kpi-panel rounded-xl border px-4 py-3">
            <div className="text-[11px] text-slate-300 font-semibold tracking-[.08em]">{item.label}</div>
            <div className="text-[24px] font-semibold font-mono text-white tabular-nums mt-2">{item.value}</div>
            <div className="text-[12px] text-slate-300 mt-1">{item.detail}</div>
          </div>
        ))}
      </section>


      {isError && (
        <div role="alert" className="cds-data-error rounded-xl border px-4 py-4">
          <div className="text-[14px] font-semibold text-white">Container inventory could not be loaded</div>
          <p className="text-[13px] text-slate-300 mt-1">The register has not been treated as empty. Retry to retrieve the latest records.</p>
          <button type="button" onClick={() => { void refetch(); }} className="cds-secondary-action mt-3">Retry inventory</button>
        </div>
      )}

      <div className="cds-register-pagination flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
        <div className="text-[12px] text-slate-300 tabular-nums" aria-live="polite">
          Showing {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of {total.toLocaleString()} matching containers
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="cds-page-size-label">
            Rows
            <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(0); }} aria-label="Rows per page" className="cds-page-size-select">
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            per page
          </label>
          <span className="text-[12px] text-slate-300 font-mono">Page {page + 1} of {totalPages}</span>
          <button type="button" className="cds-audit-page-button" disabled={page === 0 || isFetching} onClick={() => setPage(value => Math.max(0, value - 1))}>
            <ChevronLeft size={15} /> Previous
          </button>
          <button type="button" className="cds-audit-page-button" disabled={(page + 1) * pageSize >= total || isFetching} onClick={() => setPage(value => Math.min(totalPages - 1, value + 1))}>
            Next <ChevronRight size={15} />
          </button>
        </div>
      </div>

      <DataTable
        key={serverSearch + ':' + filter + ':' + page + ':' + pageSize}
        columns={[
          { id: 'num', header: 'Container number', accessor: (r: Row) => <span className="font-mono font-semibold text-cyan-200">{s(r['number'] ?? r['container_number'])}</span> },
          { id: 'type', header: 'Equipment', accessor: (r: Row) => <span className="font-medium text-text-1">{s(r['iso_type'] ?? r['container_type'])}</span> },
          { id: 'owner', header: 'Ownership', accessor: (r: Row) => <span className="capitalize">{s(r['ownership'])}</span> },
          { id: 'condition', header: 'Condition', accessor: (r: Row) => <span className="capitalize">{s(r['condition'] ?? 'Not recorded')}</span> },
          { id: 'status', header: 'Operational status', accessor: (r: Row) => <StatusBadge status={s(r['status'])} /> },
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
        pageSize={Math.max(rows.length, 1)}
        searchable={false}
        emptyMessage={isError && !data ? 'Inventory unavailable. Retry before drawing conclusions.' : all.length === 0 ? (serverSearch ? 'No containers match this search.' : 'No container records yet. Register your first container to establish the inventory.') : 'No containers match the selected status.'}
        filters={
          <div className="cds-container-toolbar">
            <div className="flex gap-2 flex-wrap">
              {statuses.map(status => (
                <FilterChip key={status} label={status === 'all' ? 'All containers' : status.replace(/_/g, ' ')} active={filter === status} onClick={() => { setFilter(status); setPage(0); }} />
              ))}
            </div>
            <label className="cds-container-search">
              <Search size={16} aria-hidden="true" />
              <input
                value={searchInput}
                onChange={event => setSearchInput(event.target.value)}
                aria-label="Search all container records"
                placeholder="Search number, equipment, owner, condition, status or location…"
              />
              {isFetching && <span className="cds-search-indicator">Updating</span>}
            </label>
          </div>
        }
        onRowClick={(r: Row) => openDrawer('Container ' + s(r['number'] ?? r['container_number']), (
          <>
            <DrawerField label="Container number" value={s(r['number'] ?? r['container_number'])} />
            <DrawerField label="Equipment type" value={s(r['iso_type'])} />
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
