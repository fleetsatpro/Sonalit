/**
 * Structured booking references — TZ_26_08_OB_00123910.
 *
 * See backend/migrations/20260818_080_cds_booking_reference.sql for why the
 * old `BK-<timestamp36>-<random>` form was replaced and what each segment
 * means.
 */

const SEQ_WIDTH = 8;

const COUNTRY_RE = /^[A-Z]{2}$/;
const DIRECTIONS = new Set(['OB', 'IB']);

/** Matches a reference in the structured form, for parsing and validation. */
const BOOKING_REF_RE = /^([A-Z]{2})_(\d{2})_(\d{2})_(OB|IB)_(\d+)$/;

/** The org default when a booking doesn't say. Overridable per deployment. */
const DEFAULT_COUNTRY = (process.env.CDS_BOOKING_COUNTRY || 'TZ').toUpperCase();

function normaliseCountry(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  return COUNTRY_RE.test(s) ? s : DEFAULT_COUNTRY;
}

function normaliseDirection(raw) {
  const s = String(raw || '').toUpperCase().trim();
  if (DIRECTIONS.has(s)) return s;
  // Accept the words as well as the codes — the extraction pipeline reads
  // "outbound"/"inbound" off documents, and rejecting those would push the
  // mapping into every caller.
  if (s.startsWith('OUT') || s === 'EXPORT') return 'OB';
  if (s.startsWith('IN') || s === 'IMPORT') return 'IB';
  return 'OB';
}

function format({ country, year, month, direction, seq }) {
  return [
    country,
    String(year % 100).padStart(2, '0'),
    String(month).padStart(2, '0'),
    direction,
    String(seq).padStart(SEQ_WIDTH, '0'),
  ].join('_');
}

/**
 * Take the next running number for an org.
 *
 * One statement, so two bookings raised at the same instant get two different
 * numbers instead of one number and a unique-violation. `db` is the org-scoped
 * query function (req.db), so RLS applies exactly as it does everywhere else.
 */
async function nextSequence(db, orgId) {
  const r = await db(
    `INSERT INTO cds_booking_counters (org_id, next_seq)
     VALUES ($1, 2)
     ON CONFLICT (org_id) DO UPDATE
        SET next_seq = cds_booking_counters.next_seq + 1, updated_at = NOW()
     RETURNING next_seq - 1 AS seq`,
    [orgId]
  );
  return Number(r.rows[0].seq);
}

/**
 * Allocate the next booking reference for an org.
 *
 * The year and month come from the clock at the moment of raising, not from
 * the ETA or the vessel schedule: this is the date the booking entered the
 * system, which is what a controller is reconstructing when they read it back.
 */
async function allocateBookingReference(db, orgId, { country, direction, now = new Date() } = {}) {
  const seq = await nextSequence(db, orgId);
  const c = normaliseCountry(country);
  const d = normaliseDirection(direction);
  return {
    booking_number: format({
      country: c,
      year: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1,
      direction: d,
      seq,
    }),
    country_code: c,
    direction: d,
    sequence: seq,
  };
}

/** Parse a reference back into its parts, or null if it isn't structured. */
function parseBookingReference(raw) {
  const m = BOOKING_REF_RE.exec(String(raw || '').toUpperCase());
  if (!m) return null;
  return {
    country: m[1],
    year: 2000 + Number(m[2]),
    month: Number(m[3]),
    direction: m[4],
    sequence: Number(m[5]),
  };
}

module.exports = {
  allocateBookingReference,
  parseBookingReference,
  normaliseCountry,
  normaliseDirection,
  BOOKING_REF_RE,
  DEFAULT_COUNTRY,
};
