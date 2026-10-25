import { useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button.js';
import { StatusBadge, RiskBadge } from '@/components/ui/Badge.js';
import { FilterChip } from '@/components/ui/DataTable.js';
import { ProgressBar } from '@/components/ui/ProgressBar.js';
import { DrawerField, DrawerSection } from '@/components/ui/Drawer.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { SearchInput } from '@/components/ui/SearchInput.js';
import { useUIStore } from '@/stores/ui.js';
import { useShipments, useCreateShipment } from '@/hooks/useShipments.js';
import type { Shipment, ShipmentStatus } from '@/types/index.js';

type Filter = 'all' | 'in_operation' | 'delivered' | 'created' | 'closed';
const INPUT = 'w-full min-h-[40px] rounded-lg bg-ink-2 border border-white/10 px-3 text-xs text-text-0 outline-none focus:border-cds-orange';
const LABEL = 'block text-[10px] uppercase tracking-wider text-text-2 mb-1.5';
const OPERATIONAL = new Set<ShipmentStatus>(['dispatched', 'checkpoint', 'delayed', 'at_port']);
const CLOSED = new Set<ShipmentStatus>(['completed', 'archived']);
const text = (value: unknown) => value == null || value === '' ? '—' : String(value);

export default function Shipments() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [commodity, setCommodity] = useState('');
  const [eta, setEta] = useState('');
  const { openDrawer, addToast } = useUIStore();
  const { data, isLoading, isError, refetch } = useShipments();
  const create = useCreateShipment();
  const shipments = data?.data ?? [];
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return shipments.filter(row => {
      if (filter === 'in_operation' && !OPERATIONAL.has(row.status)) return false;
      if (filter === 'delivered' && row.status !== 'delivered') return false;
      if (filter === 'created' && row.status !== 'created') return false;
      if (filter === 'closed' && !CLOSED.has(row.status)) return false;
      if (!query) return true;
      return [
        row.id, row.reference, row.customerName, row.containerNumber, row.vehicleReg,
        row.driverName, row.commodity, row.origin, row.destination,
      ].some(value => String(value ?? '').toLowerCase().includes(query));
    });
  }, [shipments, filter, search]);

  const openShipmentDrawer = (row: Shipment) => openDrawer(row.reference || row.id, (
    <div>
      <div className="text-2xs text-text-2 font-mono mb-4">{text(row.commodity)} · {text(row.transporterName)}</div>
      <DrawerSection title="Shipment and assignment">
        <DrawerField label="Trip reference" value={row.reference} />
        <DrawerField label="Status" value={<StatusBadge status={row.status} />} />
        <DrawerField label="Customer" value={row.customerName || 'Not assigned'} />
        <DrawerField label="Container" value={row.containerNumber || 'Not assigned'} />
        <DrawerField label="Vehicle" value={row.vehicleReg || 'Not assigned'} />
        <DrawerField label="Driver" value={row.driverName || 'Not assigned'} />
        <DrawerField label="E-lock" value={row.lockSerial || 'Not assigned'} />
        <DrawerField label="Transporter" value={row.transporterName || 'Not assigned'} />
      </DrawerSection>
      <DrawerSection title="Movement">
        <DrawerField label="Origin" value={row.origin || '—'} />
        <DrawerField label="Destination" value={row.destination || '—'} />
        <DrawerField label="Booking" value={row.bookingRef || 'Not linked'} />
        <DrawerField label="Seal" value={row.sealNumber || 'Not recorded'} />
        <DrawerField label="ETA" value={row.eta ? new Date(row.eta).toLocaleString() : 'Not recorded'} />
        <DrawerField label="Departed" value={row.departedAt ? new Date(row.departedAt).toLocaleString() : 'Not recorded'} />
        <DrawerField label="Delivered" value={row.deliveredAt ? new Date(row.deliveredAt).toLocaleString() : 'Not recorded'} />
      </DrawerSection>
      <DrawerSection title="Assessment">
        <DrawerField label="Risk" value={<RiskBadge risk={row.risk} />} />
        <DrawerField label="Progress" value={<ProgressBar value={Number(row.progress ?? 0)} showLabel />} />
        <DrawerField label="Created" value={row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'} />
      </DrawerSection>
    </div>
  ));

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanOrigin = origin.trim();
    const cleanDestination = destination.trim();
    if (!cleanOrigin || !cleanDestination) {
      addToast('Origin and destination are required', 'error');
      return;
    }
    create.mutate({
      origin: cleanOrigin,
      destination: cleanDestination,
      commodity: commodity.trim(),
      eta: eta ? new Date(eta).toISOString() : null,
    }, {
      onSuccess: () => {
        addToast('Trip created in CDS');
        setShowCreate(false);
        setOrigin('');
        setDestination('');
        setCommodity('');
        setEta('');
      },
      onError: () => addToast('Trip creation failed. No changes were confirmed.', 'error'),
    });
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading trips…</div></div>;

  return (
    <div className="p-6 pb-10 animate-fade-in space-y-4">
      <PageHeader
        title="Trips and shipments"
        description={data ? data.total + ' persisted CDS trip records. Trip reference and state come from the operational database.' : 'Live CDS trip register.'}
        actions={<Button onClick={() => setShowCreate(value => !value)}>{showCreate ? 'Cancel' : 'New trip'}</Button>}
      />
      {showCreate && (
        <form onSubmit={submitCreate} className="rounded-xl border border-cds-orange/20 bg-white/[.02] p-4 sm:p-5">
          <div className="font-bold text-sm text-text-0 mb-1">Create a trip</div>
          <p className="text-[11px] text-text-2 mb-4">Creates a canonical CDS trip in the `created` state. Further assignment and departure must follow the server state machine.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <label><span className={LABEL}>Origin *</span><input required maxLength={255} value={origin} onChange={event => setOrigin(event.target.value)} className={INPUT} placeholder="Origin location" /></label>
            <label><span className={LABEL}>Destination *</span><input required maxLength={255} value={destination} onChange={event => setDestination(event.target.value)} className={INPUT} placeholder="Destination location" /></label>
            <label><span className={LABEL}>Commodity</span><input maxLength={100} value={commodity} onChange={event => setCommodity(event.target.value)} className={INPUT} placeholder="Cargo description" /></label>
            <label><span className={LABEL}>Planned ETA</span><input type="datetime-local" value={eta} onChange={event => setEta(event.target.value)} className={INPUT} /></label>
          </div>
          <div className="flex justify-end gap-2 mt-4"><Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create trip record'}</Button></div>
        </form>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          ['ALL TRIPS', shipments.length],
          ['IN OPERATION', shipments.filter(row => OPERATIONAL.has(row.status)).length],
          ['DELIVERED', shipments.filter(row => row.status === 'delivered').length],
          ['CREATED / UNASSIGNED', shipments.filter(row => row.status === 'created').length],
          ['CLOSED / ARCHIVED', shipments.filter(row => CLOSED.has(row.status)).length],
        ].map(([label, count]) => <div key={String(label)} className="rounded-xl border border-white/[.07] bg-white/[.02] p-3"><div className="text-[9px] uppercase font-mono tracking-wider text-text-2">{label}</div><div className="text-xl font-bold font-mono mt-2 text-text-0">{count}</div></div>)}
      </div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {([
          ['all', 'All'],
          ['in_operation', 'In operation'],
          ['delivered', 'Delivered'],
          ['created', 'Created'],
          ['closed', 'Closed / archived'],
        ] as const).map(([value, label]) => <FilterChip key={value} label={label} active={filter === value} onClick={() => setFilter(value)} />)}
        <SearchInput value={search} onChange={setSearch} placeholder="Search trip, container, customer, route…" className="ml-auto" />
      </div>
      {isError ? <div className="rounded-lg border border-red-400/20 p-4 text-xs text-red-200">Trips could not be loaded. <button type="button" onClick={() => { void refetch(); }} className="underline ml-2">Retry</button></div> : null}
      <div className="rounded-xl border border-white/[.07] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead><tr>{['Trip reference', 'State', 'Customer', 'Container', 'Vehicle / driver', 'Commodity', 'Progress', 'Risk', 'ETA'].map(title => <th key={title} className="text-left font-mono text-[9px] tracking-wider text-text-2 uppercase px-3.5 py-3 border-b border-white/[.08]">{title}</th>)}</tr></thead>
            <tbody>
              {filtered.map(row => <tr key={row.id} className="border-b border-white/[.04] cursor-pointer hover:bg-white/[.025]" onClick={() => openShipmentDrawer(row)}>
                <td className="px-3.5 py-3 font-mono text-cds-orange font-bold">{row.reference || row.id}</td>
                <td className="px-3.5 py-3"><StatusBadge status={row.status} /></td>
                <td className="px-3.5 py-3 text-text-1">{text(row.customerName)}</td>
                <td className="px-3.5 py-3 font-mono text-text-1">{text(row.containerNumber)}</td>
                <td className="px-3.5 py-3 text-text-1">{text(row.vehicleReg)}<div className="text-2xs text-text-2 mt-0.5">{text(row.driverName)}</div></td>
                <td className="px-3.5 py-3 text-text-1">{text(row.commodity)}</td>
                <td className="px-3.5 py-3"><ProgressBar value={Number(row.progress ?? 0)} color={row.risk === 'high' || row.risk === 'critical' ? 'bg-cds-red' : 'bg-cds-orange'} /></td>
                <td className="px-3.5 py-3"><RiskBadge risk={row.risk} /></td>
                <td className="px-3.5 py-3 font-mono text-text-1">{row.eta ? new Date(row.eta).toLocaleDateString() : 'Not recorded'}</td>
              </tr>)}
              {!isError && filtered.length === 0 && <tr><td colSpan={9} className="px-3.5 py-10 text-center text-text-2">{shipments.length === 0 ? 'No trip records exist yet. Create a trip when an operational movement is ready.' : 'No trips match these filters.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
