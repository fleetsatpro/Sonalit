import { useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button.js';
import { StatusBadge } from '@/components/ui/Badge.js';
import { FilterChip } from '@/components/ui/DataTable.js';
import { DrawerField, DrawerSection } from '@/components/ui/Drawer.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { SearchInput } from '@/components/ui/SearchInput.js';
import { useUIStore } from '@/stores/ui.js';
import { useContainers, useCreateContainer } from '@/hooks/useContainers.js';
import { CONTAINER_TYPES } from '@/lib/constants.js';
import type { Container, ContainerStatus } from '@/types/index.js';

const s = (value: unknown) => String(value ?? '—');
type Filter = 'all' | ContainerStatus;
const STATUS_FILTERS: Filter[] = ['all', 'available', 'booked', 'awaiting_pickup', 'in_transit', 'at_port', 'delivered', 'maintenance'];
const OWNERSHIPS: Array<Container['ownership']> = ['owned', 'leased', 'customer'];
const CONDITIONS: Array<NonNullable<Container['condition']>> = ['new', 'good', 'fair', 'damaged', 'retired'];
const CONTAINER_TYPES_LIST = Object.keys(CONTAINER_TYPES);
const inputClass = 'w-full min-h-[40px] rounded-lg bg-ink-2 border border-white/10 px-3 text-xs text-text-0 outline-none focus:border-cds-orange';
const labelClass = 'block text-[10px] uppercase tracking-wider text-text-2 mb-1.5';

export default function Containers() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [number, setNumber] = useState('');
  const [isoType, setIsoType] = useState('20GP');
  const [ownership, setOwnership] = useState<Container['ownership']>('leased');
  const [manufacturer, setManufacturer] = useState('');
  const [yearBuilt, setYearBuilt] = useState('');
  const [condition, setCondition] = useState<NonNullable<Container['condition']>>('good');
  const [status, setStatus] = useState<ContainerStatus>('available');
  const { openDrawer, addToast } = useUIStore();
  const { data, isLoading, isError, refetch } = useContainers();
  const create = useCreateContainer();
  const containers = data?.data ?? [];
  const summary = useMemo(() => ({
    total: containers.length,
    available: containers.filter(item => item.status === 'available').length,
    deployed: containers.filter(item => ['booked', 'awaiting_pickup', 'in_transit', 'at_port'].includes(item.status)).length,
    inspection: containers.filter(item => ['damaged', 'retired'].includes(String(item.condition))).length,
  }), [containers]);
  const filtered = containers.filter(item => {
    if (filter !== 'all' && item.status !== filter) return false;
    const query = search.trim().toLowerCase();
    return !query || [item.number, item.isoType, item.containerType, item.ownership, item.status, item.condition, item.currentLocation, item.manufacturer]
      .some(value => String(value ?? '').toLowerCase().includes(query));
  });

  const openDetails = (container: Container) => openDrawer(container.number, (
    <div>
      <div className="text-2xs font-mono text-text-2 mb-4">{container.containerType || CONTAINER_TYPES[container.isoType] || container.isoType}</div>
      <DrawerSection title="Container identity">
        <DrawerField label="Container number" value={container.number} />
        <DrawerField label="ISO type" value={container.isoType} />
        <DrawerField label="Ownership" value={container.ownership} />
        <DrawerField label="Operational status" value={<StatusBadge status={container.status} />} />
        <DrawerField label="Physical condition" value={container.condition || 'Not recorded'} />
      </DrawerSection>
      <DrawerSection title="Specifications">
        <DrawerField label="Manufacturer" value={container.manufacturer || 'Not recorded'} />
        <DrawerField label="Year built" value={container.yearBuilt || 'Not recorded'} />
        <DrawerField label="Container size" value={container.containerSize ? container.containerSize + ' ft' : 'Not recorded'} />
        <DrawerField label="Max payload" value={container.maxWeight ? container.maxWeight.toLocaleString() + ' kg' : 'Not recorded'} />
        <DrawerField label="Tare weight" value={container.tareWeight ? container.tareWeight.toLocaleString() + ' kg' : 'Not recorded'} />
        <DrawerField label="Current location" value={container.currentLocation || 'Not recorded'} />
      </DrawerSection>
      <DrawerSection title="Inspection">
        <DrawerField label="Last inspection" value={container.lastInspection ? new Date(container.lastInspection).toLocaleDateString() : 'Not recorded'} />
        <DrawerField label="Next inspection" value={container.nextInspection ? new Date(container.nextInspection).toLocaleDateString() : 'Not recorded'} />
      </DrawerSection>
    </div>
  ));

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanNumber = number.trim().toUpperCase();
    if (!cleanNumber) {
      addToast('Container number is required', 'error');
      return;
    }
    create.mutate({
      number: cleanNumber,
      isoType,
      containerType: CONTAINER_TYPES[isoType] || isoType,
      containerSize: Number.parseInt(isoType, 10) || 20,
      ownership,
      manufacturer: manufacturer.trim(),
      yearBuilt: yearBuilt ? Number(yearBuilt) : undefined,
      condition,
      status,
    }, {
      onSuccess: () => {
        addToast('Container registered');
        setShowCreate(false);
        setNumber('');
        setManufacturer('');
        setYearBuilt('');
      },
      onError: () => addToast('Container registration failed. No changes were confirmed.', 'error'),
    });
  };

  return (
    <div className="p-6 pb-10 animate-fade-in space-y-4">
      <PageHeader
        title="Container inventory"
        description={data ? data.total + ' persisted container records in this organisation.' : 'Live container inventory.'}
        actions={<Button onClick={() => setShowCreate(value => !value)}>{showCreate ? 'Cancel registration' : 'Register container'}</Button>}
      />
      {showCreate && (
        <form onSubmit={submitCreate} className="rounded-xl border border-cds-orange/20 bg-white/[.02] p-4 sm:p-5">
          <div className="font-bold text-sm text-text-0 mb-1">Register a container</div>
          <p className="text-[11px] text-text-2 mb-4">This creates a real container inventory record in CDS.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <label><span className={labelClass}>Container number *</span><input required maxLength={20} value={number} onChange={e => setNumber(e.target.value)} className={inputClass} placeholder="e.g. MSKU1234567" /></label>
            <label><span className={labelClass}>ISO type *</span><select value={isoType} onChange={e => setIsoType(e.target.value)} className={inputClass}>{CONTAINER_TYPES_LIST.map(type => <option key={type} value={type}>{type} · {CONTAINER_TYPES[type]}</option>)}</select></label>
            <label><span className={labelClass}>Ownership *</span><select value={ownership} onChange={e => setOwnership(e.target.value as Container['ownership'])} className={inputClass}>{OWNERSHIPS.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
            <label><span className={labelClass}>Operational status *</span><select value={status} onChange={e => setStatus(e.target.value as ContainerStatus)} className={inputClass}>{STATUS_FILTERS.filter(value => value !== 'all').map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
            <label><span className={labelClass}>Manufacturer</span><input value={manufacturer} onChange={e => setManufacturer(e.target.value)} maxLength={100} className={inputClass} /></label>
            <label><span className={labelClass}>Year built</span><input type="number" min="1950" max={new Date().getFullYear() + 1} value={yearBuilt} onChange={e => setYearBuilt(e.target.value)} className={inputClass} /></label>
            <label><span className={labelClass}>Physical condition *</span><select value={condition} onChange={e => setCondition(e.target.value as NonNullable<Container['condition']>)} className={inputClass}>{CONDITIONS.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          </div>
          <div className="flex flex-wrap justify-end gap-2 mt-4"><Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? 'Registering…' : 'Create container record'}</Button></div>
        </form>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['REGISTERED', summary.total],
          ['AVAILABLE', summary.available],
          ['IN OPERATIONAL FLOW', summary.deployed],
          ['CONDITION REVIEW', summary.inspection],
        ].map(([title, value]) => <div key={String(title)} className="rounded-xl border border-white/[.07] bg-white/[.02] p-3"><div className="text-[9px] uppercase font-mono tracking-widest text-text-2">{title}</div><div className="text-xl font-bold font-mono text-text-0 mt-2">{value}</div></div>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map(value => <FilterChip key={value} label={value === 'all' ? 'All' : value.replaceAll('_', ' ')} active={filter === value} onClick={() => setFilter(value)} />)}
        <SearchInput value={search} onChange={setSearch} placeholder="Search number, type, ownership, location…" className="ml-auto" />
      </div>
      {isError ? <div className="rounded-lg border border-red-400/20 p-4 text-xs text-red-200">Container inventory could not be loaded. <button type="button" onClick={() => { void refetch(); }} className="underline ml-2">Retry</button></div> : null}
      <div className="rounded-xl border border-white/[.07] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead><tr>{['Container', 'ISO type', 'Ownership', 'Condition', 'Operational status', 'Location', 'Built'].map(title => <th key={title} className="text-left font-mono text-[9px] uppercase tracking-wider text-text-2 px-3.5 py-3 border-b border-white/[.08]">{title}</th>)}</tr></thead>
            <tbody>{filtered.map(container => <tr key={container.id} className="border-b border-white/[.04] hover:bg-white/[.025] cursor-pointer" onClick={() => openDetails(container)}>
              <td className="px-3.5 py-3 font-mono font-bold text-cds-orange">{container.number}</td>
              <td className="px-3.5 py-3 text-text-1">{container.isoType || '—'}</td>
              <td className="px-3.5 py-3 capitalize text-text-1">{container.ownership}</td>
              <td className="px-3.5 py-3 capitalize text-text-1">{container.condition || 'Not recorded'}</td>
              <td className="px-3.5 py-3"><StatusBadge status={container.status} /></td>
              <td className="px-3.5 py-3 text-text-1">{container.currentLocation || 'Not recorded'}</td>
              <td className="px-3.5 py-3 font-mono text-text-1">{container.yearBuilt || '—'}</td>
            </tr>)}
            {!isLoading && filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-text-2">{isError ? 'Data is unavailable; retry to refresh.' : containers.length === 0 ? 'No container records exist yet. Register the first container when ready.' : 'No containers match these filters.'}</td></tr>}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
