/**
 * Shared vocabulary for the container manifest — columns, formatters, the
 * booking-reference grammar, and the severity scale the integrity scan reports
 * against.
 *
 * Kept out of the components so the grouped view, the flat sheet and the
 * anomaly panel all describe the same thing the same way. A severity colour
 * that means "critical" in one panel and "high" in another is worse than no
 * colour at all.
 */

export type Row = Record<string, unknown>;

export const str = (v: unknown) => (v == null || v === '' ? '' : String(v));

/**
 * The sheet writes times as a bare 24h clock with an "hrs" suffix — 0056hrs,
 * 0314hrs. Locale formatting would make these unrecognisable to the people
 * reading them, so format explicitly.
 */
export function hrs(v: unknown): string {
  if (!v) return '';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}hrs`;
}

export function shortDate(v: unknown): string {
  if (!v) return '';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

// ─── Booking references ──────────────────────────────────────────────────────

export interface BookingRef {
  country: string;
  yy: string;
  mm: string;
  direction: 'OB' | 'IB';
  sequence: string;
}

const REF_RE = /^([A-Z]{2})_(\d{2})_(\d{2})_(OB|IB)_(\d+)$/;

/**
 * Parse TZ_26_08_OB_00123910 into its parts, or null for a legacy `BK-…`
 * reference. Rendering the parts separately is the point: a controller scanning
 * a column of these is looking for the branch or the month, not reading the
 * whole string, and undifferentiated 20-character monospace defeats that.
 */
export function parseBookingRef(raw: unknown): BookingRef | null {
  const m = REF_RE.exec(String(raw ?? '').toUpperCase());
  if (!m) return null;
  return {
    country: m[1] as string,
    yy: m[2] as string,
    mm: m[3] as string,
    direction: m[4] as 'OB' | 'IB',
    sequence: m[5] as string,
  };
}

export const DIRECTION_META: Record<string, { label: string; color: string }> = {
  OB: { label: 'Outbound', color: '#ff7a00' },
  IB: { label: 'Inbound', color: '#37e6ff' },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (mm: string) => MONTHS[Number(mm) - 1] ?? mm;

// ─── Severity ────────────────────────────────────────────────────────────────

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface Anomaly {
  id: string;
  code: string;
  severity: Severity;
  title: string;
  detail: string;
  booking_id: string | null;
  booking_number: string | null;
  container_id: string | null;
  container_number: string | null;
  peers?: { container_id?: string; container_number?: string; booking_number?: string }[];
}

export const SEVERITY: Record<Severity, { label: string; color: string; rank: number }> = {
  critical: { label: 'Critical', color: '#ff5c5c', rank: 0 },
  high:     { label: 'High',     color: '#ffb020', rank: 1 },
  medium:   { label: 'Medium',   color: '#37e6ff', rank: 2 },
  low:      { label: 'Low',      color: '#94a3b8', rank: 3 },
};

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

/** The worst severity in a set, or null when the set is empty. */
export function worstSeverity(items: { severity: Severity }[]): Severity | null {
  let worst: Severity | null = null;
  for (const i of items) {
    if (!worst || SEVERITY[i.severity].rank < SEVERITY[worst].rank) worst = i.severity;
  }
  return worst;
}

// ─── Container lifecycle ─────────────────────────────────────────────────────

export const CONTAINER_STAGES = [
  { id: 'pending',    label: 'Pending',    color: '#64748b' },
  { id: 'assigned',   label: 'Assigned',   color: '#94a3b8' },
  { id: 'in_transit', label: 'In transit', color: '#ff7a00' },
  { id: 'at_port',    label: 'At port',    color: '#ffb020' },
  { id: 'delivered',  label: 'Delivered',  color: '#33d6a8' },
  { id: 'completed',  label: 'Completed',  color: '#33d6a8' },
] as const;

export const STAGE_COLOR: Record<string, string> =
  Object.fromEntries(CONTAINER_STAGES.map(s => [s.id, s.color]));

export const YARD_STATES = ['yard', 'inbound', 'outbound', 'complete'] as const;

export const YARD_COLOR: Record<string, string> = {
  yard: '#94a3b8', inbound: '#37e6ff', outbound: '#ff7a00', complete: '#33d6a8',
};

// ─── The sheet ───────────────────────────────────────────────────────────────

export interface Col { key: string; label: string; w: number; render?: (r: Row) => string }

/**
 * Mirrors the spreadsheet ops already run on, column for column and in the same
 * order — someone who knows the sheet can read this without being retrained.
 * The identifying columns come first because they are the ones you scroll away
 * from last.
 *
 * `booking_number` is absent from the grouped view's columns: the group header
 * carries it, and repeating a 20-character reference on every row of the same
 * booking is exactly the pile-up this redesign is undoing.
 */
export const CONTAINER_COLS: Col[] = [
  { key: 'packing_list_no',  label: 'PACKING LIST NO', w: 150 },
  { key: 'container_number', label: 'CONTAINER NO',   w: 130 },
  { key: 'iso_type',         label: 'TYPE',           w: 72 },
  { key: 'seal_number',      label: 'SEAL 1',         w: 128 },
  { key: 'seal_number_2',    label: 'SEAL 2',         w: 128 },
  { key: 'status',           label: 'STAGE',          w: 104 },
  { key: 'clamped_at',       label: 'DATE CLAMPED',   w: 108, render: r => shortDate(r['clamped_at']) },
  { key: 'clamped_at_t',     label: 'TIME CLAMPED',   w: 106, render: r => hrs(r['clamped_at']) },
  { key: 'unclamped_at',     label: 'TIME UNCLAMPED', w: 116, render: r => hrs(r['unclamped_at']) },
  { key: 'lock_number',      label: 'LOCK NO',        w: 96 },
  { key: 'terminal',         label: 'TERMINAL',       w: 90 },
  { key: 'yard_status',      label: 'LOCATION',       w: 100 },
  { key: 'transporter',      label: 'TRANSPORTER',    w: 120 },
  { key: 'horse_reg',        label: 'HORSE REG',      w: 100 },
  { key: 'trailer_reg',      label: 'TRAILER REG',    w: 100 },
  { key: 'driver_name',      label: 'DRIVER NAME',    w: 120 },
  { key: 'driver_contact',   label: 'DRIVER CONTACT', w: 118 },
  { key: 'invoiced',         label: 'INVOICED',       w: 84 },
];

/** The flat sheet keeps the booking-identifying columns, since it has no header to carry them. */
export const FLAT_COLS: Col[] = [
  { key: 'booking_number',    label: 'BOOKING NO',       w: 190 },
  { key: 'carrier_reference', label: 'CARRIER REF',      w: 118 },
  { key: 'vessel',            label: 'VESSEL',           w: 160 },
  { key: 'file_reference',    label: 'AW FILE REF NO',   w: 118 },
  { key: 'controller',        label: 'CONTROLLER',       w: 104 },
  { key: 'commodity',         label: 'COMMODITY',        w: 110 },
  ...CONTAINER_COLS,
];

/**
 * Refs and registrations are read character by character when someone is
 * checking a container against a physical plate, so they get a mono face.
 */
export const MONO = new Set([
  'booking_number', 'file_reference', 'carrier_reference', 'container_number', 'seal_number',
  'seal_number_2', 'packing_list_no', 'lock_number', 'horse_reg', 'trailer_reg',
  'driver_contact', 'commodity', 'iso_type',
]);
