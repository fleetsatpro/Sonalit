/**
 * Integrity scan over the container manifest.
 *
 * The manifest is where a booking's containers become real: numbers typed off
 * the side of a box, seals read in the rain, locks fitted at a gate. Every one
 * of those is a place a mistake enters, and until now nothing looked. A
 * container number transposed by two digits, the same seal recorded on two
 * boxes, one e-lock claimed by two containers at once — all of it sat in the
 * sheet looking exactly like correct data until something failed at the port.
 *
 * This finds them. The rules are deliberately the ones with an unambiguous
 * physical meaning: a thing that cannot be true of real containers, or a
 * record that contradicts itself. Nothing here is a heuristic about how ops
 * *should* work — a manifest screen that cries wolf gets ignored, and then the
 * real duplicate goes unnoticed too.
 */
const { validateContainerNumber } = require('./containerNumber');

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

/** In transit, so a lock and a truck are physically committed to this box. */
const MOVING = new Set(['in_transit', 'at_port']);

/** A container sitting "in transit" longer than this is almost certainly stale data. */
const STALE_TRANSIT_DAYS = 7;

function keyOf(v) {
  return String(v || '').trim().toUpperCase();
}

/**
 * Group rows by a normalised key, dropping blanks.
 * Blank is not a duplicate of blank — three containers with no seal recorded
 * yet is a gap, not a collision, and reporting it as one would bury the real
 * collisions under noise.
 */
function groupBy(rows, pick) {
  const map = new Map();
  for (const r of rows) {
    const k = keyOf(pick(r));
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

function peer(r) {
  return {
    container_id: r.id,
    container_number: r.container_number,
    booking_id: r.booking_id,
    booking_number: r.booking_number,
  };
}

/**
 * @param {object[]} rows  manifest rows (see the SELECT in routes/cds.js)
 * @param {object[]} bookings  { id, booking_number, reference }
 * @returns {object[]} findings, most severe first
 */
function scanManifest(rows, bookings = []) {
  const findings = [];
  const add = (f) => findings.push(f);

  // ── Collisions across the whole org ────────────────────────────────────────
  // A container number is globally unique to a physical box, so the same one on
  // two live rows means one of them is wrong — and the wrong one may be the row
  // a crew is about to clamp against.
  for (const [num, group] of groupBy(rows, r => r.container_number)) {
    if (group.length < 2) continue;
    for (const r of group) {
      add({
        id: `duplicate_container:${r.id}`,
        code: 'duplicate_container',
        severity: 'critical',
        title: 'Duplicate container number',
        detail: `${num} appears on ${group.length} live manifest rows.`,
        booking_id: r.booking_id,
        booking_number: r.booking_number,
        container_id: r.id,
        container_number: r.container_number,
        peers: group.filter(x => x.id !== r.id).map(peer),
      });
    }
  }

  // A shipping seal is single-use by definition — the same number on two boxes
  // means one was mis-recorded, or a seal was reused, and both matter to the
  // custody chain the port crew verifies against. A container carries two
  // seals (line + shipper/customs), and a number colliding across either
  // column is the same problem, so both are folded into one seal namespace: a
  // seal1 on box A that reappears as a seal2 on box B still gets caught.
  const sealMap = new Map();
  for (const r of rows) {
    for (const s of [r.seal_number, r.seal_number_2]) {
      const k = keyOf(s);
      if (!k) continue;
      if (!sealMap.has(k)) sealMap.set(k, []);
      // A container listing the same seal in both its own columns is a data
      // entry quirk, not a collision — dedupe per container.
      if (!sealMap.get(k).some(x => x.id === r.id)) sealMap.get(k).push(r);
    }
  }
  for (const [seal, group] of sealMap) {
    if (group.length < 2) continue;
    for (const r of group) {
      add({
        id: `duplicate_seal:${r.id}:${seal}`,
        code: 'duplicate_seal',
        severity: 'high',
        title: 'Seal number used more than once',
        detail: `Seal ${seal} is recorded on ${group.length} containers.`,
        booking_id: r.booking_id,
        booking_number: r.booking_number,
        container_id: r.id,
        container_number: r.container_number,
        peers: group.filter(x => x.id !== r.id).map(peer),
      });
    }
  }

  // One e-lock cannot be on two moving containers. Restricted to moving rows
  // because a released lock is *meant* to be re-fitted to the next box.
  const moving = rows.filter(r => MOVING.has(String(r.status)));
  for (const [lock, group] of groupBy(moving, r => r.lock_number)) {
    if (group.length < 2) continue;
    for (const r of group) {
      add({
        id: `lock_double_booked:${r.id}`,
        code: 'lock_double_booked',
        severity: 'critical',
        title: 'E-lock on two containers at once',
        detail: `Lock ${lock} is fitted to ${group.length} containers that are still in transit.`,
        booking_id: r.booking_id,
        booking_number: r.booking_number,
        container_id: r.id,
        container_number: r.container_number,
        peers: group.filter(x => x.id !== r.id).map(peer),
      });
    }
  }

  // Same truck, two boxes, both moving. Legitimate for a pair of 20ft on one
  // trailer, so only flag three or more — beyond that it is a data error, not
  // a load plan.
  for (const [reg, group] of groupBy(moving, r => r.horse_reg)) {
    if (group.length < 3) continue;
    for (const r of group) {
      add({
        id: `truck_overloaded:${r.id}`,
        code: 'truck_overloaded',
        severity: 'high',
        title: 'Truck carrying too many containers',
        detail: `${reg} is recorded against ${group.length} containers still in transit.`,
        booking_id: r.booking_id,
        booking_number: r.booking_number,
        container_id: r.id,
        container_number: r.container_number,
        peers: group.filter(x => x.id !== r.id).map(peer),
      });
    }
  }

  // Two bookings quoting the same customer file reference is how one shipment
  // ends up invoiced twice.
  for (const [ref, group] of groupBy(bookings, b => b.reference)) {
    if (group.length < 2) continue;
    for (const b of group) {
      add({
        id: `duplicate_booking_reference:${b.id}`,
        code: 'duplicate_booking_reference',
        severity: 'medium',
        title: 'Duplicate file reference',
        detail: `File ref ${ref} is on ${group.length} bookings.`,
        booking_id: b.id,
        booking_number: b.booking_number,
        container_id: null,
        container_number: null,
        peers: group.filter(x => x.id !== b.id)
          .map(x => ({ booking_id: x.id, booking_number: x.booking_number })),
      });
    }
  }

  // ── Row-level contradictions ──────────────────────────────────────────────
  for (const r of rows) {
    const base = {
      booking_id: r.booking_id,
      booking_number: r.booking_number,
      container_id: r.id,
      container_number: r.container_number,
      peers: [],
    };

    const num = keyOf(r.container_number);
    if (!num) {
      add({ ...base, id: `missing_container_number:${r.id}`, code: 'missing_container_number',
        severity: 'medium', title: 'No container number',
        detail: 'This row has no container number, so nothing can be matched against it at the gate.' });
    } else {
      const v = validateContainerNumber(num);
      if (!v.ok && v.reason === 'check_digit') {
        add({ ...base, id: `invalid_check_digit:${r.id}`, code: 'invalid_check_digit',
          severity: 'high', title: 'Container number fails its check digit',
          detail: `${num} should end in ${v.expected}, not ${v.found} — likely a mistyped or misread digit.` });
      } else if (!v.ok && v.reason === 'format') {
        add({ ...base, id: `malformed_container_number:${r.id}`, code: 'malformed_container_number',
          severity: 'medium', title: 'Container number is the wrong shape',
          detail: `${num} is not four letters followed by seven digits.` });
      }
    }

    const clamped = r.clamped_at ? new Date(r.clamped_at) : null;
    const unclamped = r.unclamped_at ? new Date(r.unclamped_at) : null;

    if (clamped && unclamped && unclamped < clamped) {
      add({ ...base, id: `clamp_time_inversion:${r.id}`, code: 'clamp_time_inversion',
        severity: 'critical', title: 'Unclamped before it was clamped',
        detail: 'The recorded unclamp time is earlier than the clamp time — one of the two is wrong.' });
    }

    if (MOVING.has(String(r.status)) && !clamped) {
      add({ ...base, id: `transit_without_clamp:${r.id}`, code: 'transit_without_clamp',
        severity: 'high', title: 'In transit with no clamp recorded',
        detail: 'The container is moving but no clamp was logged, so its custody chain has no opening event.' });
    }

    if (String(r.status) === 'delivered' && !unclamped) {
      add({ ...base, id: `delivered_without_unclamp:${r.id}`, code: 'delivered_without_unclamp',
        severity: 'medium', title: 'Delivered with no unclamp recorded',
        detail: 'Marked delivered, but the port never logged an unclamp.' });
    }

    if (clamped && !keyOf(r.lock_number) && MOVING.has(String(r.status))) {
      add({ ...base, id: `clamped_without_lock:${r.id}`, code: 'clamped_without_lock',
        severity: 'medium', title: 'Clamped but no lock number',
        detail: 'A clamp was recorded without the e-lock serial that was fitted.' });
    }

    if (clamped && MOVING.has(String(r.status))) {
      const days = (Date.now() - clamped.getTime()) / 86_400_000;
      if (days > STALE_TRANSIT_DAYS) {
        add({ ...base, id: `stale_in_transit:${r.id}`, code: 'stale_in_transit',
          severity: 'medium', title: 'In transit for an unusually long time',
          detail: `Clamped ${Math.floor(days)} days ago and still not delivered.` });
      }
    }
  }

  findings.sort((a, b) =>
    (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) ||
    String(a.booking_number).localeCompare(String(b.booking_number)) ||
    String(a.code).localeCompare(String(b.code)));

  return findings;
}

module.exports = { scanManifest, SEVERITY_RANK, STALE_TRANSIT_DAYS };
