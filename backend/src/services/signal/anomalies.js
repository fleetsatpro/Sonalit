'use strict';

/**
 * Signal-integrity classification for a Guardian device — the pre-hijack tell.
 *
 * Two distinct blackout shapes, told apart by comparing when the device was
 * last SEEN (any heartbeat) against when it last delivered a real GPS FIX:
 *
 *  - comms_blackout: no contact at all past the threshold. Device dark —
 *    jammed on cellular, powered off, or battery pulled.
 *  - gps_frozen:     still heartbeating, but no GPS fix for a while. Classic
 *    GPS jammer: the satellite fix dies while the cellular link survives, so
 *    the truck's position sticks while the device still "checks in".
 *
 * Severity escalates to critical when the device is on an active convoy — a
 * blackout mid-run is the moment that precedes a hijack, versus a phone idle
 * in a depot drawer.
 *
 * Pure: takes already-fetched fields + a `now`, returns a verdict. No DB, no
 * clock — unit-testable and deterministic.
 */

const MIN = 60000;

function minsAgo(ms) { return Math.round(ms / MIN); }

function classifySignal(dev, now, opts = {}) {
  const commsBlackoutMs = opts.commsBlackoutMs ?? 6 * MIN;
  const gpsStaleMs = opts.gpsStaleMs ?? 5 * MIN;

  const nowMs = now instanceof Date ? now.getTime() : now;
  const lastSeen = dev.last_seen ? new Date(dev.last_seen).getTime() : null;
  const lastFix = dev.last_fix_at ? new Date(dev.last_fix_at).getTime() : null;
  const onConvoy = !!dev.on_active_convoy;

  if (lastSeen == null) {
    return { state: 'no_data', severity: 'low', reasons: ['never reported in'],
      seen_age_ms: null, fix_age_ms: null };
  }

  const seenAge = nowMs - lastSeen;
  const fixAge = lastFix == null ? Infinity : nowMs - lastFix;
  const crit = onConvoy ? 'critical' : 'high';

  if (seenAge > commsBlackoutMs) {
    return { state: 'comms_blackout', severity: crit,
      reasons: [`no contact for ${minsAgo(seenAge)} min${onConvoy ? ' during an active convoy' : ''}`],
      seen_age_ms: seenAge, fix_age_ms: Number.isFinite(fixAge) ? fixAge : null };
  }

  if (fixAge > gpsStaleMs) {
    const detail = lastFix == null ? 'no GPS fix on record' : `no GPS fix for ${minsAgo(fixAge)} min`;
    return { state: 'gps_frozen', severity: crit,
      reasons: [`online but ${detail} — possible GPS jamming${onConvoy ? ' on an active convoy' : ''}`],
      seen_age_ms: seenAge, fix_age_ms: Number.isFinite(fixAge) ? fixAge : null };
  }

  return { state: 'ok', severity: 'low', reasons: [], seen_age_ms: seenAge, fix_age_ms: fixAge };
}

// Worst-first ordering for a dispatch board.
const STATE_RANK = { comms_blackout: 0, gps_frozen: 1, no_data: 2, ok: 3 };
function bySeverity(a, b) {
  const r = (STATE_RANK[a.state] ?? 9) - (STATE_RANK[b.state] ?? 9);
  return r !== 0 ? r : (b.seen_age_ms ?? 0) - (a.seen_age_ms ?? 0);
}

module.exports = { classifySignal, bySeverity, STATE_RANK };
