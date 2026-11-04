import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Search, Plus } from 'lucide-react';
import { FilterChip, StatusBadge } from './components.js';
import { CONTAINER_TYPES } from './constants.js';
import { useContainers, useCreateContainer } from './hooks.js';
import { useCDSStore } from './store.js';

type Row = Record<string, unknown>;
type StatusFilter = 'all' | 'available' | 'booked' | 'awaiting_pickup' | 'in_transit' | 'at_port' | 'delivered' | 'maintenance';
type ConditionFilter = 'all' | 'new' | 'good' | 'fair' | 'damaged' | 'retired';
type OwnershipFilter = 'all' | 'owned' | 'leased' | 'customer';

const PAGE_SIZE = 25;
const STATUS_FILTERS: StatusFilter[] = ['all', 'available', 'booked', 'awaiting_pickup', 'in_transit', 'at_port', 'delivered', 'maintenance'];
const CONDITIONS: ConditionFilter[] = ['all', 'new', 'good', 'fair', 'damaged', 'retired'];
const OWNERSHIPS: OwnershipFilter[] = ['all', 'owned', 'leased', 'customer'];
const TYPES = CONTAINER_TYPES as Record<string, string>;
const fieldClass = 'w-full min-h-[42px] rounded-lg bg-[#101a2b] border border-white/10 px-3 text-[13px] text-white outline-none focus:border-[#70a7e8] focus:ring-2 focus:ring-[#70a7e8]/20';
const labelClass = 'mb-1.5 block text-[10px] font-semibold uppercase tracking-[.13em] text-white/55';

function text(row: Row, key: string): string {
  const value = row[key];
  return value == null || value === '' ? '' : String(value);
}

function display(value: unknown): string {
  return value == null || value === '' ? 'Not recorded' : String(value);
}

function pretty(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b[a-z]/g, letter => letter.toUpperCase());
}

function formatDate(value: unknown): string {
  if (!value) return 'Not scheduled';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? 'Unrecognised date'
    : new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

const ISO_LETTER_VALUES: Record<string, number> = (() => {
  const values: Record<string, number> = {};
  let value = 10;
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    values[letter] = value;
    value += 1;
    if (value % 11 === 0) value += 1;
  }
  return values;
})();

export function iso6346CheckDigit(containerNumber: string): number | null {
  const code = containerNumber.trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z]{3}[UJZ][0-9]{7}$/.test(code)) return null;
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const character = code[index];
    const value = character >= 'A' && character <= 'Z'
      ? ISO_LETTER_VALUES[character]
      : Number(character);
    sum += value * (2 ** index);
  }
  const remainder = sum % 11;
  return remainder === 10 ? 0 : remainder;
}

export function isValidIso6346ContainerNumber(containerNumber: string): boolean {
  const code = containerNumber.trim().toUpperCase().replace(/\s+/g, '');
  const checkDigit = iso6346CheckDigit(code);
  return checkDigit !== null && checkDigit === Number(code[10]);
}

function Metric({ label, value, note }: { label: string; value: number | undefined; note: string }) {
  return (
    <div className="min-w-0 border-l border-white/[.09] pl-4 first:border-l-0 first:pl-0">
      <div className="text-[9px] font-semibold uppercase tracking-[.14em] text-white/45">{label}</div>
      <div className="mt-1 font-mono text-[23px] font-semibold leading-none tracking-tight text-white tabular-nums">{value == null ? '—' : value.toLocaleString()}</div>
      <div className="mt-1 text-[10px] text-white/38">{note}</div>
    </div>
  );
}

function ContainerDetails({ container }: { container: Row }) {
  const number = text(container, 'number');
  const location = text(container, 'current_location');
  const lat = container['lat'];
  const lng = container['lng'];
  const coordinates = lat != null && lng != null
    ? Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5)
    : '';

  const field = (label: string, value: unknown) => (
    <div className="flex items-start justify-between gap-5 border-b border-white/[.07] py-2.5 last:border-0">
      <dt className="shrink-0 text-[11px] text-white/45">{label}</dt>
      <dd className="min-w-0 text-right text-[12px] font-medium text-white/85 break-words">{display(value)}</dd>
    </div>
  );

  return (
    <div className="space-y-5 pb-5">
      <div>
        <div className="font-mono text-[19px] font-semibold tracking-[.04em] text-white">{number}</div>
        <div className="mt-1 text-[11px] text-white/45">{display(container['container_type'])} · {display(container['iso_type'])}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusBadge status={text(container, 'status') || 'unknown'} />
          <StatusBadge status={text(container, 'condition') || 'unknown'} />
        </div>
      </div>
      <section>
        <div className="mb-1 text-[9px] font-semibold uppercase tracking-[.16em] text-[#8eb9ed]">Identity & ownership</div>
        <dl>
          {field('Container number', number)}
          {field('ISO equipment code', container['iso_type'])}
          {field('Ownership', container['ownership'])}
          {field('Operational state', pretty(text(container, 'status')))}
          {field('Physical condition', pretty(text(container, 'condition')))}
        </dl>
      </section>
      <section>
        <div className="mb-1 text-[9px] font-semibold uppercase tracking-[.16em] text-[#8eb9ed]">Equipment specifications</div>
        <dl>
          {field('Manufacturer', container['manufacturer'])}
          {field('Year built', container['year_built'])}
          {field('Nominal size', container['container_size'] ? String(container['container_size']) + ' ft' : null)}
          {field('Maximum payload', container['max_weight_kg'] != null ? Number(container['max_weight_kg']).toLocaleString() + ' kg' : null)}
          {field('Tare weight', container['tare_weight_kg'] != null ? Number(container['tare_weight_kg']).toLocaleString() + ' kg' : null)}
          {field('Length', container['length_m'] != null ? String(container['length_m']) + ' m' : null)}
          {field('Width', container['width_m'] != null ? String(container['width_m']) + ' m' : null)}
          {field('Height', container['height_m'] != null ? String(container['height_m']) + ' m' : null)}
        </dl>
      </section>
      <section>
        <div className="mb-1 text-[9px] font-semibold uppercase tracking-[.16em] text-[#8eb9ed]">Location & inspection</div>
        <dl>
          {field('Recorded location', location || coordinates || null)}
          {field('Coordinate record', coordinates || null)}
          {field('Last inspection', formatDate(container['last_inspection']))}
          {field('Next inspection', formatDate(container['next_inspection']))}
        </dl>
        <p className="mt-2 text-[10px] leading-relaxed text-white/35">Location and inspection values are the records currently stored in CDS. They are not presented as a verified live GPS fix or an independent inspection certificate.</p>
      </section>
      <section>
        <div className="mb-1 text-[9px] font-semibold uppercase tracking-[.16em] text-[#8eb9ed]">Record provenance</div>
        <dl>
          {field('Record created', formatDate(container['created_at']))}
          {field('Last record update', formatDate(container['updated_at']))}
          {field('Container record ID', container['id'])}
        </dl>
      </section>
    </div>
  );
}

function RegisterContainerForm() {
  const create = useCreateContainer();
  const { closeDrawer, addToast } = useCDSStore();
  const [number, setNumber] = useState('');
  const [isoType, setIsoType] = useState('20GP');
  const [ownership, setOwnership] = useState<'owned' | 'leased' | 'customer'>('leased');
  const [condition, setCondition] = useState<'new' | 'good' | 'fair' | 'damaged' | 'retired'>('good');
  const [manufacturer, setManufacturer] = useState('');
  const [yearBuilt, setYearBuilt] = useState('');
  const [maxWeight, setMaxWeight] = useState('');
  const [tareWeight, setTareWeight] = useState('');
  const [error, setError] = useState('');
  const normalizedNumber = number.trim().toUpperCase().replace(/\s+/g, '');
  const numberComplete = normalizedNumber.length === 11;
  const numberValid = isValidIso6346ContainerNumber(normalizedNumber);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!numberValid) {
      setError('Enter a valid ISO 6346 container number, including its check digit.');
      return;
    }
    const year = yearBuilt ? Number(yearBuilt) : null;
    if (yearBuilt && (!Number.isInteger(year) || year! < 1950 || year! > new Date().getFullYear() + 1)) {
      setError('Enter a plausible year of manufacture.');
      return;
    }
    const max = maxWeight ? Number(maxWeight) : null;
    const tare = tareWeight ? Number(tareWeight) : null;
    if ((max != null && (!Number.isFinite(max) || max <= 0)) || (tare != null && (!Number.isFinite(tare) || tare <= 0))) {
      setError('Weights must be positive numbers in kilograms.');
      return;
    }
    create.mutate({
      number: normalizedNumber,
      iso_type: isoType,
      container_type: TYPES[isoType] || isoType,
      container_size: Number.parseInt(isoType, 10) || 20,
      ownership,
      manufacturer: manufacturer.trim() || null,
      year_built: year,
      condition,
      max_weight_kg: max,
      tare_weight_kg: tare,
    }, {
      onSuccess: () => {
        addToast('Container registered and added to available inventory.', 'success');
        closeDrawer();
      },
      onError: () => setError('Registration was not confirmed. Check the container number and try again.'),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4 pb-6">
      <p className="text-[11px] leading-relaxed text-white/50">Register a physical equipment record. Newly registered containers enter the available inventory state; booking, dispatch, clamp and delivery workflows own subsequent operational transitions.</p>
      <label className="block">
        <span className={labelClass}>ISO 6346 container number *</span>
        <input required autoFocus maxLength={11} value={number} onChange={event => setNumber(event.target.value.toUpperCase())} className={fieldClass + ' font-mono tracking-[.08em]'} placeholder="MSCU6639870" autoCapitalize="characters" spellCheck={false} />
        <span className={'mt-1.5 block text-[10px] ' + (!number ? 'text-white/35' : numberValid ? 'text-emerald-300' : numberComplete ? 'text-red-300' : 'text-white/45')}>
          {!number ? 'Owner code · equipment category · serial · check digit' : numberValid ? 'ISO 6346 check digit verified' : numberComplete ? 'Check digit does not match this container number' : 'Complete the 11-character equipment identifier'}
        </span>
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>ISO equipment type *</span>
          <select value={isoType} onChange={event => setIsoType(event.target.value)} className={fieldClass}>
            {Object.entries(TYPES).map(([code, name]) => <option key={code} value={code}>{code} · {name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Ownership *</span>
          <select value={ownership} onChange={event => setOwnership(event.target.value as typeof ownership)} className={fieldClass}>
            <option value="owned">Owned</option><option value="leased">Leased</option><option value="customer">Customer-owned</option>
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Physical condition *</span>
          <select value={condition} onChange={event => setCondition(event.target.value as typeof condition)} className={fieldClass}>
            <option value="new">New</option><option value="good">Good</option><option value="fair">Fair</option><option value="damaged">Damaged</option><option value="retired">Retired</option>
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Manufacturer</span>
          <input value={manufacturer} onChange={event => setManufacturer(event.target.value)} maxLength={100} className={fieldClass} placeholder="Manufacturer name" />
        </label>
        <label className="block">
          <span className={labelClass}>Year built</span>
          <input type="number" min="1950" max={new Date().getFullYear() + 1} value={yearBuilt} onChange={event => setYearBuilt(event.target.value)} className={fieldClass} placeholder="e.g. 2022" />
        </label>
        <label className="block">
          <span className={labelClass}>Maximum payload (kg)</span>
          <input type="number" min="1" step="0.01" value={maxWeight} onChange={event => setMaxWeight(event.target.value)} className={fieldClass} placeholder="Optional" />
        </label>
        <label className="block">
          <span className={labelClass}>Tare weight (kg)</span>
          <input type="number" min="1" step="0.01" value={tareWeight} onChange={event => setTareWeight(event.target.value)} className={fieldClass} placeholder="Optional" />
        </label>
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-400/25 bg-red-400/[.07] px-3 py-2.5 text-[11px] text-red-200">{error}</div>}
      <div className="sticky bottom-0 flex gap-2 border-t border-white/[.08] bg-[#0b1422] pt-3">
        <button type="button" onClick={closeDrawer} disabled={create.isPending} className="min-h-[42px] flex-1 rounded-lg border border-white/10 px-3 text-[12px] font-semibold text-white/70 hover:bg-white/[.05] disabled:opacity-40">Cancel</button>
        <button type="submit" disabled={create.isPending || !numberValid} className="min-h-[42px] flex-[1.4] rounded-lg bg-[#a8c9ee] px-3 text-[12px] font-bold text-[#0a1727] hover:bg-[#c3dbf6] disabled:cursor-not-allowed disabled:opacity-40">{create.isPending ? 'Registering…' : 'Register container'}</button>
      </div>
      <p className="text-[10px] leading-relaxed text-white/35">The operational state is assigned by the CDS record default. Registration does not create a booking, allocate a vehicle or lock, or record a custody event.</p>
    </form>
  );
}

export function CDSContainerRegister() {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [condition, setCondition] = useState<ConditionFilter>('all');
  const [ownership, setOwnership] = useState<OwnershipFilter>('all');
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const { openDrawer } = useCDSStore();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(queryInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  const filters = {
    page,
    pageSize: PAGE_SIZE,
    ...(status !== 'all' ? { status } : {}),
    ...(condition !== 'all' ? { condition } : {}),
    ...(ownership !== 'all' ? { ownership } : {}),
    ...(query ? { query } : {}),
  };
  const { data, isLoading, isError, refetch, isFetching } = useContainers(filters);
  const { data: allCount } = useContainers({ page: 1, pageSize: 1 });
  const { data: availableCount } = useContainers({ page: 1, pageSize: 1, status: 'available' });
  const { data: deployedCount } = useContainers({ page: 1, pageSize: 1, status: 'booked,awaiting_pickup,in_transit,at_port' });
  const { data: maintenanceCount } = useContainers({ page: 1, pageSize: 1, status: 'maintenance' });
  const rows = (data?.data ?? []) as Row[];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total === 0 ? 0 : ((page - 1) * PAGE_SIZE) + 1;
  const last = Math.min(page * PAGE_SIZE, total);

  const openDetails = (container: Row) => {
    const number = text(container, 'number') || 'Container record';
    openDrawer(number, <ContainerDetails container={container} />);
  };

  const openRegistration = () => openDrawer('Register container', <RegisterContainerForm />);

  const changeFilter = (change: () => void) => {
    change();
    setPage(1);
  };

  const keyOpen = (event: KeyboardEvent<HTMLTableRowElement>, row: Row) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openDetails(row);
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6">
      <div className="flex flex-col justify-between gap-4 border-b border-white/[.08] pb-5 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <div className="text-[9px] font-semibold uppercase tracking-[.19em] text-[#8eb9ed]">Equipment control / Inventory</div>
          <h1 className="mt-1 text-[22px] font-semibold tracking-[-.035em] text-white sm:text-[25px]">Container register</h1>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-white/45">Authoritative equipment records, physical condition and recorded inspection details. Operational movement remains controlled by bookings and trip execution.</p>
        </div>
        <button type="button" onClick={openRegistration} className="min-h-[42px] shrink-0 rounded-lg border border-[#9dc2ed]/35 bg-[#8eb9ed]/[.12] px-4 text-[12px] font-semibold text-[#c3defc] transition-colors hover:bg-[#8eb9ed]/[.2] focus:outline-none focus:ring-2 focus:ring-[#8eb9ed]/60">Register container <Plus size={14} aria-hidden="true" className="ml-1" /></button>
      </div>

      <div className="grid grid-cols-2 gap-y-4 border-b border-white/[.08] py-4 sm:grid-cols-4 sm:gap-0">
        <Metric label="Registered" value={allCount?.total} note="organisation register" />
        <Metric label="Available" value={availableCount?.total} note="ready for allocation" />
        <Metric label="Operationally committed" value={deployedCount?.total} note="booked through port arrival" />
        <Metric label="Maintenance" value={maintenanceCount?.total} note="operational state" />
      </div>

      <div className="flex flex-col gap-3 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search container records</span>
            <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35" />
            <input value={queryInput} onChange={event => setQueryInput(event.target.value)} placeholder="Search number, type, location or manufacturer" className="min-h-[40px] w-full rounded-lg border border-white/[.10] bg-[#101a2b] pl-9 pr-3 text-[12px] text-white outline-none placeholder:text-white/30 focus:border-[#8eb9ed]/60 focus:ring-2 focus:ring-[#8eb9ed]/15" />
          </label>
          <div className="grid grid-cols-2 gap-2 sm:w-[340px]">
            <label>
              <span className="sr-only">Filter by operational status</span>
              <select value={status} onChange={event => changeFilter(() => setStatus(event.target.value as StatusFilter))} className="min-h-[40px] w-full rounded-lg border border-white/[.10] bg-[#101a2b] px-2.5 text-[11px] text-white outline-none focus:border-[#8eb9ed]/60">
                {STATUS_FILTERS.map(value => <option key={value} value={value}>{value === 'all' ? 'All operational states' : pretty(value)}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Filter by physical condition</span>
              <select value={condition} onChange={event => changeFilter(() => setCondition(event.target.value as ConditionFilter))} className="min-h-[40px] w-full rounded-lg border border-white/[.10] bg-[#101a2b] px-2.5 text-[11px] text-white outline-none focus:border-[#8eb9ed]/60">
                {CONDITIONS.map(value => <option key={value} value={value}>{value === 'all' ? 'All conditions' : pretty(value)}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[9px] font-semibold uppercase tracking-[.13em] text-white/35">Ownership</span>
          {OWNERSHIPS.map(value => <FilterChip key={value} label={value === 'all' ? 'All' : pretty(value)} active={ownership === value} onClick={() => changeFilter(() => setOwnership(value))} />)}
          <span className="ml-auto flex items-center gap-2 text-[10px] text-white/35" aria-live="polite">
            {isFetching && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#8eb9ed]" />}
            {isFetching ? 'Refreshing records' : data ? 'Persisted register' : 'Awaiting records'}
          </span>
        </div>
      </div>

      {isError ? (
        <div role="alert" className="rounded-xl border border-red-300/20 bg-red-400/[.045] px-4 py-5">
          <div className="text-[13px] font-semibold text-white">Container register unavailable</div>
          <p className="mt-1 text-[11px] text-white/50">The records could not be loaded. No inventory values are being inferred.</p>
          <button type="button" onClick={() => void refetch()} className="mt-3 min-h-[38px] rounded-lg border border-white/15 px-3 text-[11px] font-semibold text-white/80 hover:bg-white/[.05]">Retry</button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[.09] bg-[#0d1726]">
          <div className="flex flex-col justify-between gap-1 border-b border-white/[.08] px-4 py-3 sm:flex-row sm:items-center">
            <div className="text-[11px] font-semibold text-white/80">Equipment records <span className="ml-1 font-mono font-normal text-white/35">{total.toLocaleString()}</span></div>
            <div className="text-[10px] text-white/35">{total === 0 ? 'No matching records' : 'Showing ' + first.toLocaleString() + '–' + last.toLocaleString() + ' of ' + total.toLocaleString()}</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[930px] border-collapse text-left">
              <thead className="bg-white/[.025]">
                <tr className="text-[9px] font-semibold uppercase tracking-[.12em] text-white/40">
                  <th className="px-4 py-3">Container identity</th>
                  <th className="px-3 py-3">Equipment type</th>
                  <th className="px-3 py-3">Ownership</th>
                  <th className="px-3 py-3">Operational state</th>
                  <th className="px-3 py-3">Condition</th>
                  <th className="px-3 py-3">Recorded location</th>
                  <th className="px-3 py-3">Next inspection</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[.06]">
                {isLoading ? Array.from({ length: 7 }, (_, index) => (
                  <tr key={index}>
                    {Array.from({ length: 7 }, (_, cell) => <td key={cell} className="px-3 py-4"><div className="h-3 animate-pulse rounded bg-white/[.06]" /></td>)}
                  </tr>
                )) : rows.map(row => {
                  const nextInspection = row['next_inspection'];
                  const overdue = Boolean(nextInspection && !Number.isNaN(new Date(String(nextInspection)).getTime()) && new Date(String(nextInspection)).getTime() < Date.now());
                  return (
                    <tr key={text(row, 'id')} tabIndex={0} role="button" aria-label={'Open container ' + text(row, 'number')} onClick={() => openDetails(row)} onKeyDown={event => keyOpen(event, row)} className="cursor-pointer outline-none transition-colors hover:bg-[#18304d]/45 focus-visible:bg-[#18304d]/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8eb9ed]/70">
                      <td className="px-4 py-3.5">
                        <div className="font-mono text-[12px] font-semibold tracking-[.035em] text-[#bad8fb]">{display(row['number'])}</div>
                        <div className="mt-1 text-[9px] text-white/35">{text(row, 'id').slice(0, 8) || 'No record reference'}</div>
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="text-[11px] text-white/80">{display(row['iso_type'])}</div>
                        <div className="mt-1 text-[9px] text-white/35">{display(row['container_type'])}</div>
                      </td>
                      <td className="px-3 py-3.5 text-[11px] text-white/65">{pretty(text(row, 'ownership')) || 'Not recorded'}</td>
                      <td className="px-3 py-3.5"><StatusBadge status={text(row, 'status') || 'unknown'} /></td>
                      <td className="px-3 py-3.5"><StatusBadge status={text(row, 'condition') || 'unknown'} /></td>
                      <td className="max-w-[180px] px-3 py-3.5">
                        <div className="truncate text-[11px] text-white/70">{text(row, 'current_location') || 'Not recorded'}</div>
                        {row['lat'] != null && row['lng'] != null && <div className="mt-1 font-mono text-[9px] text-white/35">{Number(row['lat']).toFixed(4)}, {Number(row['lng']).toFixed(4)}</div>}
                      </td>
                      <td className="px-3 py-3.5">
                        <div className={'text-[10px] ' + (overdue ? 'font-semibold text-red-300' : 'text-white/60')}>{overdue ? 'Overdue · ' : ''}{formatDate(nextInspection)}</div>
                      </td>
                    </tr>
                  );
                })}
                {!isLoading && rows.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-12 text-center">
                    <div className="text-[13px] font-semibold text-white/75">{total === 0 && !query && status === 'all' && condition === 'all' && ownership === 'all' ? 'No containers registered yet' : 'No matching containers'}</div>
                    <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-white/40">{total === 0 && !query && status === 'all' && condition === 'all' && ownership === 'all' ? 'Register the first equipment record to establish your container inventory.' : 'Adjust the search or filters to broaden the register.'}</p>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col justify-between gap-2 border-t border-white/[.08] px-4 py-3 sm:flex-row sm:items-center">
            <span className="text-[10px] text-white/35">Operational status and physical condition are independent records.</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={page <= 1 || isLoading} onClick={() => setPage(value => Math.max(1, value - 1))} className="min-h-[36px] rounded-lg border border-white/10 px-3 text-[10px] font-semibold text-white/70 hover:bg-white/[.05] disabled:opacity-30">Previous</button>
              <span className="min-w-[76px] text-center font-mono text-[10px] text-white/45">Page {page} / {totalPages}</span>
              <button type="button" disabled={page >= totalPages || isLoading} onClick={() => setPage(value => Math.min(totalPages, value + 1))} className="min-h-[36px] rounded-lg border border-white/10 px-3 text-[10px] font-semibold text-white/70 hover:bg-white/[.05] disabled:opacity-30">Next</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
