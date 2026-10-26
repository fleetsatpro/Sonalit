'use strict';

const PUBLICATION_TLP_LEVELS = Object.freeze([
  'CLEAR',
  'GREEN',
  'AMBER',
  'AMBER+STRICT',
  'RED'
]);

function normalizeLevel(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/^TLP\s*[:\-]?\s*/, '')
    .replace(/\s+/g, '');
}

function buildPublicationHandling({ level, actorId=null, now=new Date() }={}) {
  const normalized = normalizeLevel(level);
  if (!PUBLICATION_TLP_LEVELS.includes(normalized)) {
    throw new Error('Choose a supported FIRST TLP 2.0 handling level.');
  }
  const timestamp = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(timestamp.getTime())) throw new Error('Handling timestamp is invalid.');
  return {
    scheme:'FIRST_TLP_2_0',
    level:normalized,
    label:'TLP:' + normalized,
    set_at:timestamp.toISOString(),
    set_by:actorId || null
  };
}

module.exports = { PUBLICATION_TLP_LEVELS, normalizeLevel, buildPublicationHandling };
