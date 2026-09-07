/* Deterministic observation -> event fusion for the Intelligence Centre. */
const { query } = require('../config/database');
const logger = require('./logger');

const RANK = { low: 1, moderate: 2, high: 3, critical: 4 };
const SEVERITY = ['informational','low','moderate','high','critical'];

function normalizeTitle(v) {
  return String(v || '').toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}
function severityFor(text) {
  const s = String(text || '');
  if (/massacre|terrorist attack|bombing|explosion|ambush|kidnap|abduct|gunfire|fatal|killed/i.test(s)) return 'high';
  if (/attack|clash|violence|armed|militia|insurgent|protest|riot|unrest|roadblock|robbery|bandit|checkpoint|curfew/i.test(s)) return 'moderate';
  return 'low';
}
function confidenceFor(observations) {
  const sources = new Set(observations.map(o => o.source_id).filter(Boolean));
  const avg = observations.reduce((s,o) => s + Number(o.credibility ?? 50), 0) / Math.max(1, observations.length);
  return Math.min(98, Math.round(avg * 0.72 + Math.min(24, Math.max(0, sources.size - 1) * 8)));
}

async function fuseOrg(orgId) {
  const { rows } = await query(`
    SELECT io.*, s.reliability, s.provider
    FROM intel_observations io
    LEFT JOIN intel_sources s ON s.id=io.source_id
    WHERE io.org_id=$1 AND io.observed_at >= now()-interval '48 hours'
    ORDER BY io.observed_at DESC LIMIT 5000`, [orgId]);

  const groups = new Map();
  for (const o of rows) {
    if (!o.country_code) continue;
    const key = `${o.country_code}:${normalizeTitle(o.title || o.body)}`;
    if (!key.split(':')[1]) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }

  let created = 0, linked = 0, contradictions = 0;
  for (const observations of groups.values()) {
    const latest = observations[0];
    const severity = observations.reduce((best, o) => RANK[severityFor(`${o.title || ''} ${o.body || ''}`)] > RANK[best] ? severityFor(`${o.title || ''} ${o.body || ''}`) : best, 'low');
    const title = String(latest.title || latest.body || 'Intelligence event').slice(0, 240);
    const confidence = confidenceFor(observations);
    const { rows: existing } = await query(`SELECT id FROM intel_events WHERE org_id=$1 AND country_code=$2 AND title=$3 AND last_seen_at>=now()-interval '48 hours' LIMIT 1`, [orgId, latest.country_code, title]);
    let eventId = existing[0]?.id;

    if (!eventId) {
      const r = await query(`INSERT INTO intel_events (org_id,event_type,title,summary,status,severity,confidence,country_code,first_seen_at,last_seen_at,indicators,assessment) VALUES ($1,'fused_osint',$2,$3,'fused',$4,$5,$6,$7,$7,$8,$9) RETURNING id`, [orgId,title,String(latest.body || title).slice(0,2000),severity,confidence,latest.country_code,latest.observed_at,JSON.stringify([{type:'source_count',value:new Set(observations.map(o=>o.source_id)).size},{type:'observation_count',value:observations.length}]),JSON.stringify({providers:[...new Set(observations.map(o=>o.provider).filter(Boolean))],fusion:'deterministic',version:1})]);
      eventId = r.rows[0].id;
      created++;
    } else {
      await query(`UPDATE intel_events SET severity=$2, confidence=GREATEST(confidence,$3), last_seen_at=GREATEST(last_seen_at,$4), status='fused', updated_at=now() WHERE id=$1`, [eventId,severity,confidence,latest.observed_at]);
    }

    for (const o of observations) {
      const relationship = o.body && latest.body && normalizeTitle(o.body) !== normalizeTitle(latest.body) && severityFor(o.body) !== severityFor(latest.body) ? 'context' : 'supports';
      if (relationship === 'context') contradictions++;
      await query(`INSERT INTO intel_event_observations (event_id,observation_id,relationship,weight) VALUES ($1,$2,$3,$4) ON CONFLICT (event_id,observation_id) DO UPDATE SET relationship=EXCLUDED.relationship,weight=EXCLUDED.weight`, [eventId,o.id,relationship,Math.min(98, Number(o.reliability ?? 50))]);
      linked++;
    }
  }
  return { observations: rows.length, groups: groups.size, created, linked, context_links: contradictions };
}

module.exports = { fuseOrg };
