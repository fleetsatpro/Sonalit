import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Search, Plus } from 'lucide-react';
import { Badge, StatusBadge } from './components.js';
import { CONTAINER_TYPES } from './constants.js';
import { useContainerHistory, useContainers, useCreateContainer } from './hooks.js';
import { useCDSStore } from './store.js';

type Row = Record<string, unknown>;
type StatusFilter = 'all' | 'available' | 'booked' | 'awaiting_pickup' | 'in_transit' | 'at_port' | 'delivered' | 'maintenance';
type ConditionFilter = 'all' | 'new' | 'good' | 'fair' | 'damaged' | 'retired';

const PAGE_SIZE = 25;
const STATUS_FILTERS: StatusFilter[] = ['all', 'available', 'booked', 'awaiting_pickup', 'in_transit', 'at_port', 'delivered', 'maintenance'];
const CONDITIONS: ConditionFilter[] = ['all', 'new', 'good', 'fair', 'damaged', 'retired'];
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

const EQUIPMENT_FAMILIES: Record<string, string> = {
  GP: 'General-purpose dry',
  HC: 'High-cube dry',
  RF: 'Refrigerated',
  OT: 'Open-top',
  FR: 'Flat rack',
  TK: 'Tank',
};

/** CDS shorthand describes nominal length and equipment family, not the full ISO size/type code. */
export function equipmentTypeLabel(code: string, fallback?: string): string {
  const normalized = code.trim().toUpperCase();
  const match = normalized.match(/^(\d{2})(GP|HC|RF|OT|FR|TK)$/);
  if (match) return `${match[1]} ft · ${EQUIPMENT_FAMILIES[match[2]]}`;
  if (fallback) return fallback.replace(/^(\d{2})'\s*/, '$1 ft · ');
  return normalized || 'Not recorded';
}

const MOVEMENT_STAGES: Record<string, { label: string; step: number; detail: string }> = {
  booked: { label: 'Booked', step: 1, detail: 'Booking confirmed' },
  awaiting_pickup: { label: 'Awaiting pickup', step: 2, detail: 'Pending yard departure' },
  in_transit: { label: 'In transit', step: 3, detail: 'Movement underway' },
  at_port: { label: 'At port', step: 4, detail: 'Awaiting port completion' },
  delivered: { label: 'Delivered', step: 5, detail: 'Delivery milestone recorded' },
};

export function containerMovementProgress(status: string) {
  const normalized = status.trim().toLowerCase();
  const stage = MOVEMENT_STAGES[normalized];
  if (stage) return { ...stage, total: 5, percent: stage.step * 20, active: true };
  if (normalized === 'available') {
    return { label: 'Available', step: 0, total: 5, percent: 0, active: false, detail: 'Not allocated to a journey' };
  }
  if (normalized === 'maintenance') {
    return { label: 'Maintenance', step: 0, total: 5, percent: 0, active: false, detail: 'Not in active movement' };
  }
  return {
    label: normalized ? pretty(normalized) : 'Unknown',
    step: 0, total: 5, percent: 0, active: false,
    detail: 'No recognised movement stage recorded',
  };
}

function formatDate(value: unknown): string {
  if (!value) return 'Not scheduled';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? 'Unrecognised date'
    : new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function formatDateTime(value: unknown): string {
  if (!value) return 'Not recorded';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? 'Unrecognised timestamp' : date.toLocaleString();
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
  if (!/^[A-Z]{3}U[0-9]{7}$/.test(code)) return null;
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

function ConditionBadge({ condition }: { condition: string }) {
  const variant = condition === 'new' || condition === 'good'
    ? 'ok'
    : condition === 'fair' ? 'warn'
      : condition === 'damaged' || condition === 'retired' ? 'bad' : 'neutral';
  return <Badge variant={variant}>{condition ? pretty(condition).toUpperCase() : 'UNKNOWN'}</Badge>;
}

function MovementProgress({ status }: { status: string }) {
  const movement = containerMovementProgress(status);
  return (
    <div className="cds-movement-progress min-w-[148px]">
      <div className="flex items-center justify-between gap-2">
        <span className="cds-movement-progress__label">{movement.label}</span>
        {movement.active && <span className="cds-movement-progress__step">{movement.step}/{movement.total}</span>}
      </div>
      {movement.active ? (
        <>
          <div
            className="cds-movement-progress__track mt-2"
            role="progressbar"
            aria-label={`${movement.label} journey stage`}
            aria-valuemin={0}
            aria-valuemax={movement.total}
            aria-valuenow={movement.step}
            aria-valuetext={`${movement.label}, stage ${movement.step} of ${movement.total}`}
          >
            <span className="cds-movement-progress__fill" style={{ width: `${movement.percent}%` }} />
          </div>
          <div className="cds-movement-progress__detail mt-1">{movement.detail}</div>
        </>
      ) : (
        <div className="cds-movement-progress__detail mt-1">{movement.detail}</div>
      )}
    </div>
  );
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
  const { data: history, isLoading: historyLoading, isError: historyError, refetch: refetchHistory } =
    useContainerHistory(text(container, 'id') || null);
  const historyEvents = (history?.data ?? []) as Row[];
  const chainStatus = history?.chain_status ?? (historyLoading ? 'LOADING' : historyError ? 'UNAVAILABLE' : 'NO_LEDGER');
  const chainBadge = chainStatus === 'VERIFIED' ? 'ok' : chainStatus === 'BROKEN' ? 'bad' : 'warn';
  const timestamp = (value: unknown) => {
    if (!value) return 'Time not recorded';
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? 'Unrecognised timestamp' : date.toLocaleString();
  };
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
        <div className="mt-1 text-[13px] font-semibold text-white/80">{equipmentTypeLabel(text(container, 'iso_type'), text(container, 'container_type'))}</div>
        <div className="mt-0.5 font-mono text-[11px] text-white/45">Group shorthand · {display(container['iso_type'])}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <StatusBadge status={text(container, 'status') || 'unknown'} />
          <ConditionBadge condition={text(container, 'condition')} />
        </div>
      </div>

      <section className="rounded-xl border border-[#8eb9ed]/15 bg-[#13243a]/55 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[.15em] text-[#a9cdf4]">Movement & custody history</div>
            <p className="mt-1 text-[10px] text-white/45">Recorded clamp and unclamp actions, with the assigned lock, driver and vehicle linked to each movement. The custody hash verifies the event itself. Driver, vehicle and lock attribution uses the clamp-time audit snapshot when available, otherwise only the values stored on the manifest. Mutable trip assignments are never used to reconstruct history.</p>
          </div>
          <Badge variant={chainBadge}>
            {chainStatus === 'LOADING' ? 'CHECKING HISTORY' : chainStatus === 'UNAVAILABLE' ? 'STATUS UNAVAILABLE' : chainStatus === 'VERIFIED' ? 'CHAIN VERIFIED' : chainStatus === 'BROKEN' ? 'CHAIN INTEGRITY ALERT' : chainStatus === 'PARTIAL' ? 'PARTIAL / LEGACY EVENTS' : 'LEGACY / NO LEDGER'}
          </Badge>
        </div>
        {historyLoading ? (
          <div className="mt-4 space-y-3" aria-label="Loading container history">
            {[0, 1, 2].map(item => <div key={item} className="h-14 rounded-lg bg-white/[.035] animate-pulse" />)}
          </div>
        ) : historyError ? (
          <div className="mt-3 rounded-lg border border-red-300/20 bg-red-300/[.05] p-3">
            <p className="text-[11px] text-red-100">Custody history could not be loaded. Container identity and inventory details remain available.</p>
            <button type="button" onClick={() => void refetchHistory()} className="mt-2 text-[11px] font-semibold text-[#b9d8fb] underline underline-offset-4">Retry history</button>
          </div>
        ) : historyEvents.length === 0 ? (
          <div className="mt-3 rounded-lg border border-dashed border-white/10 px-3 py-5 text-center">
            <div className="text-[12px] font-semibold text-white/70">No clamp or unclamp events recorded</div>
            <p className="mt-1 text-[10px] text-white/40">This container may not have entered a recorded yard-to-port movement yet.</p>
          </div>
        ) : (
          <div className="mt-4 space-y-0">
            {historyEvents.map((event, index) => {
              const kind = text(event, 'kind');
              const integrity = event['integrity_verified'];
              const eventIntegrity = integrity === true ? 'Verified' : integrity === false ? 'Integrity failure' : 'Legacy timestamp';
              return (
                <div key={text(event, 'id') || String(index)} className="relative grid grid-cols-[18px_minmax(0,1fr)] gap-2.5 pb-4 last:pb-0">
                  <div className="relative flex justify-center">
                    <span className={'mt-1 h-2.5 w-2.5 rounded-full border ' + (kind === 'clamped' ? 'border-cds-teal bg-cds-teal shadow-[0_0_10px_rgba(51,214,168,.3)]' : kind === 'unclamped' ? 'border-[#9d8df5] bg-[#9d8df5]' : 'border-white/30 bg-white/30')} />
                    {index < historyEvents.length - 1 && <span className="absolute top-4 bottom-0 w-px bg-white/10" />}
                  </div>
                  <div className="min-w-0 rounded-lg border border-white/[.07] bg-black/15 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-[12px] font-semibold text-white">{kind === 'clamped' ? 'E-lock clamped' : kind === 'unclamped' ? 'E-lock unclamped' : pretty(kind)}</div>
                        <div className="mt-1 text-[10px] text-white/45">{timestamp(event['timestamp'])}</div>
                      </div>
                      <span className={'text-[9px] font-semibold uppercase tracking-wider ' + (integrity === true ? 'text-cds-teal' : integrity === false ? 'text-red-300' : 'text-amber-200')}>{eventIntegrity}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                      {[
                        ['Recorded by', event['actor']],
                        ['Lock at clamp', event['lock_serial']],
                        ['Driver', event['driver_name']],
                        ['Vehicle', event['vehicle_registration']],
                        ['Transport partner', event['transporter_name']],
                        ['Booking', event['booking_number']],
                        ['Trip reference', event['trip_number']],
                        ['Seal', event['seal_number']],
                      ].filter((entry) => entry[1] != null && entry[1] !== '').map(([label, value]) => (
                        <div key={String(label)} className="min-w-0">
                          <div className="text-[9px] uppercase tracking-wider text-white/35">{label}</div>
                          <div className="mt-0.5 break-words text-[11px] font-medium text-white/80">{String(value)}</div>
                        </div>
                      ))}
                    </div>
                    {event['assignment_source'] && <p className="mt-2 text-[9px] leading-relaxed text-white/35">{event['assignment_source'] === 'clamp_audit_snapshot' ? 'Assignment captured in the clamp audit at handoff; this context is not part of the custody-event hash.' : event['assignment_source'] === 'manifest_record' ? 'Assignment context comes from the stored manifest and is not independently hash-verified.' : 'No driver or vehicle assignment was recorded for this event.'}</p>}
                    {event['seal_intact'] === false && <div className="mt-2 rounded-md bg-red-400/[.08] px-2.5 py-2 text-[10px] font-semibold text-red-200">Seal verification failed at this handoff.</div>}
                    {event['seal_intact'] === true && <div className="mt-2 text-[10px] text-cds-teal">Seal reported intact at this handoff.</div>}
                    {event['notes'] ? <p className="mt-2 border-t border-white/[.06] pt-2 text-[10px] leading-relaxed text-white/50">{String(event['notes'])}</p> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {chainStatus === 'BROKEN' && <p className="mt-3 rounded-md border border-red-300/20 bg-red-300/[.05] p-2.5 text-[10px] leading-relaxed text-red-100">At least one custody record failed hash or sequence verification. Treat this history as an integrity exception and investigate before relying on it as proof of custody.</p>}
        {chainStatus !== 'VERIFIED' && chainStatus !== 'BROKEN' && historyEvents.some(event => event['evidence_source'] === 'manifest_timestamp') && <p className="mt-3 text-[10px] leading-relaxed text-amber-100/70">Some earlier movements are represented by stored manifest timestamps and audit actors. They pre-date the verifiable custody chain and are not labelled cryptographically verified.</p>}
      </section>
      <section>
        <div className="mb-1 text-[9px] font-semibold uppercase tracking-[.16em] text-[#8eb9ed]">Container identity & status</div>
        <dl>
          {field('Container number', number)}
          {field('Equipment category', equipmentTypeLabel(text(container, 'iso_type'), text(container, 'container_type')))}
          {field('Group shorthand', container['iso_type'])}
          {field('Ownership record', container['ownership'])}
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
          {field('Maximum weight', container['max_weight_kg'] != null ? Number(container['max_weight_kg']).toLocaleString() + ' kg' : null)}
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
      <p className="text-[11px] leading-relaxed text-white/50">Register a physical equipment record. Serviceable units enter available inventory; damaged or retired units are placed into maintenance. Booking, dispatch, clamp and delivery workflows own subsequent movement transitions.</p>
      <label className="block">
        <span className={labelClass}>ISO 6346 container number *</span>
        <input required autoFocus maxLength={11} value={number} onChange={event => setNumber(event.target.value.toUpperCase())} className={fieldClass + ' font-mono tracking-[.08em]'} placeholder="MSCU6639870" autoCapitalize="characters" spellCheck={false} />
        <span className={'mt-1.5 block text-[10px] ' + (!number ? 'text-white/35' : numberValid ? 'text-emerald-300' : numberComplete ? 'text-red-300' : 'text-white/45')}>
          {!number ? 'Owner code · equipment category · serial · check digit' : numberValid ? 'ISO 6346 check digit verified' : numberComplete ? 'Check digit does not match this container number' : 'Complete the 11-character equipment identifier'}
        </span>
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>Equipment category *</span>
          <select value={isoType} onChange={event => setIsoType(event.target.value)} className={fieldClass}>
            {Object.entries(TYPES).map(([code, name]) => <option key={code} value={code}>{equipmentTypeLabel(code, name)} ({code})</option>)}
          </select>
          <span className="mt-1.5 block text-[11px] leading-relaxed text-white/45">GP = standard dry · HC = taller high-cube · RF = refrigerated · OT = open-top · FR = flat rack · TK = tank. The code is a size/type grouping shorthand.</span>
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
          <span className={labelClass}>Maximum weight (kg)</span>
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
      <p className="text-[10px] leading-relaxed text-white/35">The operational state is assigned from the recorded physical condition. Registration does not create a booking, allocate a vehicle or lock, or record a custody event.</p>
    </form>
  );
}

export function CDSContainerRegister() {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [condition, setCondition] = useState<ConditionFilter>('all');
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
    <div className="cds-container-register mx-auto max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6">
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="max-w-2xl text-[11px] leading-relaxed text-white/45">Journey bars show saved lifecycle milestones — they do not estimate route distance or replace live GPS tracking.</p>
          <span className="flex items-center gap-2 text-[10px] text-white/45" aria-live="polite">
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
            <table className="cds-register-table w-full min-w-[1120px] border-collapse text-left">
              <thead className="bg-white/[.025]">
                <tr className="text-[9px] font-semibold uppercase tracking-[.12em] text-white/40">
                  <th className="px-4 py-3">Container identity</th>
                  <th className="px-3 py-3">Equipment category</th>
                  <th className="px-3 py-3">Journey progress</th>
                  <th className="px-3 py-3">Condition</th>
                  <th className="px-3 py-3">Clamp / unclamp history</th>
                  <th className="px-3 py-3">Assignment at last clamp</th>
                  <th className="px-3 py-3">Recorded location</th>
                  <th className="px-3 py-3">Next inspection</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[.06]">
                {isLoading ? Array.from({ length: 7 }, (_, index) => (
                  <tr key={index}>
                    {Array.from({ length: 8 }, (_, cell) => <td key={cell} className="px-3 py-4"><div className="h-3 animate-pulse rounded bg-white/[.06]" /></td>)}
                  </tr>
                )) : rows.map(row => {
                  const nextInspection = row['next_inspection'];
                  const overdue = Boolean(nextInspection && !Number.isNaN(new Date(String(nextInspection)).getTime()) && new Date(String(nextInspection)).getTime() < Date.now());
                  const clampAt = row['last_clamped_at'] ? new Date(String(row['last_clamped_at'])) : null;
                  const unclampAt = row['last_unclamped_at'] ? new Date(String(row['last_unclamped_at'])) : null;
                  const clampValid = Boolean(clampAt && !Number.isNaN(clampAt.getTime()));
                  const unclampValid = Boolean(unclampAt && !Number.isNaN(unclampAt.getTime()));
                  const latestIsUnclamp = unclampValid && (!clampValid || unclampAt!.getTime() >= clampAt!.getTime());
                  const hasMovement = clampValid || unclampValid;
                  return (
                    <tr key={text(row, 'id')} tabIndex={0} role="button" aria-label={'Open container ' + text(row, 'number')} onClick={() => openDetails(row)} onKeyDown={event => keyOpen(event, row)} className="cursor-pointer outline-none transition-colors hover:bg-[#18304d]/45 focus-visible:bg-[#18304d]/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8eb9ed]/70">
                      <td className="px-4 py-3.5">
                        <div className="font-mono text-[12px] font-semibold tracking-[.035em] text-[#bad8fb]">{display(row['number'])}</div>
                        <div className="mt-1 text-[9px] text-white/35">{text(row, 'id').slice(0, 8) || 'No record reference'}</div>
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="cds-register-type-name">{equipmentTypeLabel(text(row, 'iso_type'), text(row, 'container_type'))}</div>
                        <div className="cds-register-type-code mt-1">GROUP CODE · {display(row['iso_type'])}</div>
                      </td>
                      <td className="px-3 py-3.5"><MovementProgress status={text(row, 'status')} /></td>
                      <td className="px-3 py-3.5"><ConditionBadge condition={text(row, 'condition')} /></td>
                      <td className="px-3 py-3.5">
                        {hasMovement ? (
                          <div className="space-y-2">
                            {clampValid && (
                              <div>
                                <div className="text-[10px] font-semibold text-cds-teal">Clamped · {formatDateTime(row['last_clamped_at'])}</div>
                                <div className="mt-0.5 text-[10px] text-white/40">By {display(row['last_clamped_by'])}</div>
                              </div>
                            )}
                            {unclampValid && (
                              <div className="border-t border-white/[.06] pt-1.5">
                                <div className="text-[10px] font-semibold text-violet-200">Unclamped · {formatDateTime(row['last_unclamped_at'])}</div>
                                <div className="mt-0.5 text-[10px] text-white/40">By {display(row['last_unclamped_by'])}</div>
                              </div>
                            )}
                            <div className={'text-[9px] font-semibold uppercase tracking-wider ' + (latestIsUnclamp ? 'text-violet-200' : 'text-cds-teal')}>Latest recorded action · {latestIsUnclamp ? 'Unclamp' : 'Clamp'}</div>
                          </div>
                        ) : <span className="text-[10px] text-white/35">No clamp / unclamp timestamp</span>}
                      </td>
                      <td className="max-w-[210px] px-3 py-3.5">
                        <div className="font-mono text-[10px] text-[#bad8fb]">Lock at clamp · {display(row['last_lock_serial'])}</div>
                        <div className="mt-1 text-[10px] text-white/65">Driver · {display(row['last_driver_name'])}</div>
                        <div className="mt-1 text-[10px] text-white/65">Vehicle · {display(row['last_vehicle_registration'])}</div>
                        <div className="mt-1 text-[9px] text-white/35">{display(row['last_transporter_name'])}</div>
                      </td>
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
                  <tr><td colSpan={8} className="px-4 py-12 text-center">
                    <div className="text-[13px] font-semibold text-white/75">{total === 0 && !query && status === 'all' && condition === 'all' ? 'No containers registered yet' : 'No matching containers'}</div>
                    <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-white/40">{total === 0 && !query && status === 'all' && condition === 'all' ? 'Register the first equipment record to establish your container inventory.' : 'Adjust the search or filters to broaden the register.'}</p>
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
