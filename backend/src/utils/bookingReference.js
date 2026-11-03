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

/**
 * Reconcile a booking number that came in ON a sheet.
 *
 * This is the primary path — a booking sheet arrives carrying its own number,
 * and that number is authoritative. Our only jobs are to normalise it, read
 * back the country and direction it already encodes (so the manifest can group
 * and colour it without a second source of truth), and — crucially — advance
 * the org counter past it, so a later auto-allocated booking can never be
 * handed the same running number and collide.
 *
 * A number that isn't in our structured form (a legacy or third-party
 * reference) is accepted verbatim: it is still the real identifier on the
 * document, and refusing it because it doesn't match our grammar would block
 * ingesting the very sheets this exists to ingest. It just doesn't touch the
 * counter, because there is no sequence in it to keep clear of.
 */
async function reconcileProvidedReference(db, orgId, providedNumber) {
  const clean = String(providedNumber || '').trim().toUpperCase();
  if (!clean) return null;

  const parsed = parseBookingReference(clean);
  if (parsed) {
    // Move the counter to at least one past this sequence. GREATEST keeps it
    // monotonic — a sheet with a lower number than we've already reached must
    // not roll the counter backwards.
    await db(
      `INSERT INTO cds_booking_counters (org_id, next_seq)
       VALUES ($1, $2)
       ON CONFLICT (org_id) DO UPDATE
          SET next_seq = GREATEST(cds_booking_counters.next_seq, $2), updated_at = NOW()`,
      [orgId, parsed.sequence + 1]
    );
    return {
      booking_number: clean,
      country_code: parsed.country,
      direction: parsed.direction,
      sequence: parsed.sequence,
      structured: true,
    };
  }

  return { booking_number: clean, country_code: null, direction: null, sequence: null, structured: false };
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
  reconcileProvidedReference,
  parseBookingReference,
  normaliseCountry,
  normaliseDirection,
  BOOKING_REF_RE,
  DEFAULT_COUNTRY,
};
