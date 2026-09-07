const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const { buildAssessment } = require('../utils/intelligenceEngine');

router.use(authenticate);
router.use(attachOrgDb);

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  next();
}
router.use(adminOnly);

router.get('/picture', asyncHandler(async (req, res) => {
  const { rows: events } = await req.db(`SELECT * FROM intel_events WHERE last_seen_at >= now() - interval '7 days' ORDER BY last_seen_at DESC LIMIT 500`);
  const { rows: observations } = await req.db(`SELECT io.*, s.reliability, s.name AS source_name FROM intel_observations io LEFT JOIN intel_sources s ON s.id=io.source_id WHERE io.observed_at >= now() - interval '7 days' ORDER BY io.observed_at DESC LIMIT 1000`);
  const assessment = buildAssessment({ scope: 'global', events, observations });
  const { rows: countries } = await req.db(`SELECT country_code, COUNT(*)::int AS events, ROUND(AVG(confidence))::int AS confidence FROM intel_events WHERE country_code IS NOT NULL AND last_seen_at >= now() - interval '24 hours' GROUP BY country_code ORDER BY events DESC LIMIT 20`);
  res.json({ picture: { ...assessment, countries }, generated_at: new Date().toISOString() });
}));

router.get('/countries', asyncHandler(async (req, res) => {
  const { rows } = await req.db(`SELECT country_code, COUNT(*) FILTER (WHERE last_seen_at >= now() - interval '24 hours')::int AS events_24h, COUNT(*) FILTER (WHERE last_seen_at >= now() - interval '7 days')::int AS events_7d, ROUND(AVG(confidence))::int AS confidence, MAX(last_seen_at) AS last_seen_at, MAX(CASE severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'moderate' THEN 2 WHEN 'low' THEN 1 ELSE 0 END) AS severity_rank FROM intel_events WHERE country_code IS NOT NULL GROUP BY country_code ORDER BY severity_rank DESC, events_24h DESC`);
  res.json({ countries: rows });
}));

router.get('/countries/:country/publications', asyncHandler(async (req, res) => {
  const { rows } = await req.db(`SELECT * FROM intel_publications WHERE country_code=$1 ORDER BY period_end DESC NULLS LAST, created_at DESC LIMIT 100`, [req.params.country.toUpperCase()]);
  res.json({ publications: rows });
}));

router.get('/countries/:country/assessment', asyncHandler(async (req, res) => {
  const country = req.params.country.toUpperCase();
  const { rows: events } = await req.db(`SELECT * FROM intel_events WHERE country_code=$1 AND last_seen_at >= now() - interval '7 days' ORDER BY last_seen_at DESC LIMIT 300`, [country]);
  const { rows: observations } = await req.db(`SELECT io.*, s.reliability FROM intel_observations io LEFT JOIN intel_sources s ON s.id=io.source_id WHERE io.country_code=$1 AND io.observed_at >= now() - interval '7 days' ORDER BY io.observed_at DESC LIMIT 500`, [country]);
  res.json({ country, assessment: buildAssessment({ scope: { type: 'country', country }, events, observations }) });
}));

router.get('/collection/status', asyncHandler(async (req, res) => {
  const { rows: sources } = await req.db(`SELECT id,name,source_type,provider,reliability,active,last_seen_at,updated_at FROM intel_sources ORDER BY last_seen_at DESC NULLS LAST`);
  const { rows: recent } = await req.db(`SELECT source_id, COUNT(*)::int AS observations_24h, MAX(observed_at) AS latest_observation FROM intel_observations WHERE observed_at >= now()-interval '24 hours' GROUP BY source_id`);
  const bySource = new Map(recent.map(r => [String(r.source_id), r]));
  res.json({ collection: { sources: sources.map(s => ({ ...s, ...(bySource.get(String(s.id)) || { observations_24h: 0, latest_observation: null }) })), checked_at: new Date().toISOString() } });
}));

router.post('/collection/run', asyncHandler(async (_req, res) => {
  const { runCollection } = require('../utils/intelligenceCollectionBootstrap');
  const result = await runCollection();
  res.status(result?.skipped ? 202 : 200).json({ collection: result });
}));

router.post('/requirements', asyncHandler(async (req, res) => {
  const { reference, title, question, priority, scope, due_at } = req.body;
  if (!title || !question) return res.status(400).json({ error: 'title and question are required' });
  const ref = reference || `ICR-${Date.now().toString(36).toUpperCase()}`;
  const { rows } = await req.db(`INSERT INTO intel_requirements (org_id,reference,title,question,priority,scope,due_at,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [req.user.org_id, ref, title, question, priority || 'medium', scope || {}, due_at || null, req.user.id]);
  res.status(201).json({ requirement: rows[0] });
}));

router.get('/requirements', asyncHandler(async (req, res) => {
  const status = req.query.status || null;
  const { rows } = await req.db(`SELECT * FROM intel_requirements WHERE ($1::text IS NULL OR status=$1) ORDER BY CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, created_at DESC LIMIT 200`, [status]);
  res.json({ requirements: rows });
}));

router.post('/watchlists', asyncHandler(async (req, res) => {
  const { name, description, watch_type, target, severity_floor } = req.body;
  if (!name || !watch_type) return res.status(400).json({ error: 'name and watch_type are required' });
  const { rows } = await req.db(`INSERT INTO intel_watchlists (org_id,name,description,watch_type,target,severity_floor,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [req.user.org_id, name, description || null, watch_type, target || {}, severity_floor || 'moderate', req.user.id]);
  res.status(201).json({ watchlist: rows[0] });
}));

router.get('/watchlists', asyncHandler(async (req, res) => {
  const { rows } = await req.db(`SELECT * FROM intel_watchlists WHERE active=true ORDER BY created_at DESC`);
  res.json({ watchlists: rows });
}));

router.post('/advisories/draft', asyncHandler(async (req, res) => {
  const country = String(req.body.country_code || '').toUpperCase();
  if (!country) return res.status(400).json({ error: 'country_code is required' });
  const profile = req.body.traveller_profile || 'general';
  const destination = req.body.destination || null;
  const { rows: events } = await req.db(`SELECT id,title,summary,severity,confidence,last_seen_at,latitude,longitude FROM intel_events WHERE country_code=$1 AND last_seen_at >= now()-interval '7 days' ORDER BY last_seen_at DESC LIMIT 100`, [country]);
  const { rows: assessments } = await req.db(`SELECT headline,judgement,severity,confidence,evidence,validity_start,validity_end FROM intel_assessments WHERE scope_type='country' AND scope_key=$1 ORDER BY validity_start DESC LIMIT 10`, [country]);
  const severityRank = { critical: 4, high: 3, moderate: 2, low: 1, informational: 0 };
  const top = events.reduce((a, e) => severityRank[e.severity] > severityRank[a] ? e.severity : a, 'informational');
  const advisoryLevel = top === 'critical' ? 'avoid' : top === 'high' ? 'reconsider' : top === 'moderate' ? 'caution' : 'normal';
  const confidence = assessments[0]?.confidence || Math.round(events.reduce((s,e)=>s+Number(e.confidence||0),0) / Math.max(events.length,1));
  const content = { executive_summary: `Draft generated from Sonalit intelligence evidence for ${country}.`, traveller_profile: profile, destination, threat_environment: assessments, key_events: events, sections: ['security_environment','areas_of_concern','transport','civil_unrest','crime','terrorism','natural_hazards','recommended_posture','emergency_considerations'], evidence_policy: 'Every substantive claim must resolve to an observation or verified assessment before publication.' };
  const { rows } = await req.db(`INSERT INTO intel_advisories (org_id,country_code,destination,traveller_profile,advisory_level,confidence,valid_until,content,evidence,created_by) VALUES ($1,$2,$3,$4,$5,$6,now()+interval '24 hours',$7,$8,$9) RETURNING *`, [req.user.org_id,country,destination,profile,advisoryLevel,confidence,content,events.map(e=>e.id),req.user.id]);
  res.status(201).json({ advisory: rows[0] });
}));

router.get('/advisories', asyncHandler(async (req, res) => {
  const country = req.query.country_code ? String(req.query.country_code).toUpperCase() : null;
  const { rows } = await req.db(`SELECT * FROM intel_advisories WHERE ($1::text IS NULL OR country_code=$1) ORDER BY created_at DESC LIMIT 100`, [country]);
  res.json({ advisories: rows });
}));

module.exports = router;
