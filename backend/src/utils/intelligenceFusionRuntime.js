/* Deterministic observation -> event fusion for the Intelligence Centre. */
const { query } = require('../config/database');
const logger = require('./logger');
const { buildExtendedAdapters } = require('./intelligenceExtendedProviders');

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

// Extended providers are deliberately executed inside the canonical pipeline rather
// than owning their own scheduler. This keeps one orchestration path and one lock.
async function collectExtendedProviders(orgId) {
  const { rows: watchlists } = await query(`SELECT name,watch_type,target FROM intel_watchlists WHERE org_id=$1 AND active=true ORDER BY updated_at DESC LIMIT 100`, [orgId]);
  const adapters = buildExtendedAdapters(watchlists);
  const results = [];
  for (const adapter of adapters) {
    const minMinutes = adapter.provider === 'acled' ? 360 : adapter.provider === 'reliefweb' ? 60 : 30;
    try {
      const { rows: recent } = await query(`SELECT 1 FROM intel_collection_runs r JOIN intel_sources s ON s.id=r.source_id WHERE r.org_id=$1 AND s.provider=$2 AND r.status IN ('success','partial') AND r.finished_at >= now() - ($3 || ' minutes')::interval LIMIT 1`, [orgId, adapter.provider, String(minMinutes)]);
      if (recent.length) { results.push({ provider: adapter.provider, skipped: true, reason: 'cooldown' }); continue; }

      const { rows: sourceRows } = await query(`INSERT INTO intel_sources (org_id,name,source_type,provider,endpoint,reliability,metadata,last_seen_at) VALUES ($1,$2,'other',$3,$4,$5,$6::jsonb,NOW()) ON CONFLICT (org_id,provider,endpoint) WHERE provider IS NOT NULL AND endpoint IS NOT NULL DO UPDATE SET name=EXCLUDED.name,reliability=EXCLUDED.reliability,metadata=EXCLUDED.metadata,last_seen_at=NOW(),updated_at=NOW() RETURNING id`, [orgId,adapter.name,adapter.provider,adapter.endpoint,adapter.reliability,JSON.stringify({canonical_pipeline:true})]);
      const sourceId = sourceRows[0].id;
      const { rows: runRows } = await query(`INSERT INTO intel_collection_runs (org_id,source_id,metadata) VALUES ($1,$2,$3::jsonb) RETURNING id`, [orgId,sourceId,JSON.stringify({adapter:adapter.provider,canonical_pipeline:true})]);
      const runId = runRows[0].id;
      let seen=0, inserted=0, duplicate=0;
      try {
        const items = await adapter.run();
        seen = items.length;
        for (const item of items.slice(0,50)) {
          if (!item.title && !item.body) continue;
          const externalId = String(item.external_id || item.url || `${adapter.provider}:${item.title}:${item.published_at || ''}`).slice(0,500);
          const r = await query(`INSERT INTO intel_observations (org_id,source_id,external_id,observed_at,published_at,title,body,url,language,country_code,latitude,longitude,content_hash,raw_metadata,credibility,manipulation_score) VALUES ($1,$2,$3,NOW(),$4,$5,$6,$7,$8,$9,$10,$11,encode(digest(lower(coalesce($5,'') || '|' || coalesce($6,'') || '|' || coalesce($7,'')),'sha256'),'hex'),$12::jsonb,$13,$14) ON CONFLICT (org_id,source_id,external_id) DO UPDATE SET observed_at=NOW(),published_at=COALESCE(EXCLUDED.published_at,intel_observations.published_at),title=EXCLUDED.title,body=EXCLUDED.body,url=COALESCE(EXCLUDED.url,intel_observations.url),country_code=COALESCE(EXCLUDED.country_code,intel_observations.country_code),latitude=COALESCE(EXCLUDED.latitude,intel_observations.latitude),longitude=COALESCE(EXCLUDED.longitude,intel_observations.longitude),raw_metadata=EXCLUDED.raw_metadata,credibility=EXCLUDED.credibility RETURNING (xmax=0) AS inserted`, [orgId,sourceId,externalId,item.published_at || null,String(item.title || '').slice(0,500),String(item.body || item.title || '').slice(0,8000),item.url || null,item.language || null,item.country_code || null,item.latitude ?? null,item.longitude ?? null,JSON.stringify(item.raw_metadata || {}),Number.isFinite(item.credibility) ? item.credibility : adapter.reliability,0]);
          if (r.rows[0]?.inserted) inserted++; else duplicate++;
        }
        await query(`UPDATE intel_collection_runs SET finished_at=NOW(),status='success',observations_seen=$2,observations_inserted=$3,observations_duplicate=$4 WHERE id=$1`, [runId,seen,inserted,duplicate]);
        results.push({provider:adapter.provider,seen,inserted,duplicate,status:'success'});
      } catch (e) {
        await query(`UPDATE intel_collection_runs SET finished_at=NOW(),status=$2,error_count=1,error_message=$3 WHERE id=$1`, [runId,seen?'partial':'failed',String(e.message).slice(0,500)]).catch(()=>{});
        results.push({provider:adapter.provider,seen,inserted,duplicate,status:'failed',error:e.message});
        logger.warn(`Extended intelligence provider ${adapter.provider} failed for ${orgId}: ${e.message}`);
      }
    } catch (e) {
      results.push({provider:adapter.provider,status:'failed',error:e.message});
      logger.warn(`Extended intelligence setup ${adapter.provider} failed for ${orgId}: ${e.message}`);
    }
  }
  return results;
}

async function fuseOrg(orgId) {
  const extended = await collectExtendedProviders(orgId);
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
  return { observations: rows.length, groups: groups.size, created, linked, context_links: contradictions, extended_providers: extended };
}

module.exports = { fuseOrg, collectExtendedProviders };
