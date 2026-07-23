'use strict';
const crypto = require('crypto');

/**
 * Tamper-evident seal over an ordered incident timeline.
 *
 * Same hash-chain idea as the custody_events ledger (migration 034): each
 * event's digest folds in the digest of the one before it, so altering,
 * inserting, dropping or reordering ANY event changes the final digest. Export
 * the digest alongside a dossier (a PDF, an insurance claim, a court exhibit)
 * and anyone holding the same event list can re-derive it and prove the record
 * was not edited after the fact. Without the chain, a single event's hash only
 * proves that one row; the chain proves the whole sequence.
 */

const GENESIS = '0'.repeat(64);

// Only stable, identifying fields go into the hash — never volatile
// presentation text (titles/details can be re-worded without breaking a seal).
function canonical(ev) {
  return [ev.ts, ev.type, ev.id == null ? '' : ev.id,
    ev.lat == null ? '' : ev.lat, ev.lng == null ? '' : ev.lng].join('|');
}

function sealTimeline(events) {
  let prev = GENESIS;
  for (const ev of events) {
    prev = crypto.createHash('sha256').update(prev + '\n' + canonical(ev)).digest('hex');
  }
  return {
    algorithm: 'sha256-chain',
    digest: prev,
    event_count: events.length,
    sealed_at: new Date().toISOString(),
  };
}

module.exports = { sealTimeline, canonical, GENESIS };
