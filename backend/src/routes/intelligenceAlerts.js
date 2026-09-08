const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');

router.use(authenticate, attachOrgDb);

// Explicit geographic scopes. The API must never broaden a client-selected
// Kenya/East Africa view into global intelligence by omission.
const EAST_AFRICA = ['BI','DJ','ER','ET','KE','RW','SO','SS','TZ','UG'];

router.get('/', asyncHandler(async (req,res)=>{
  const limit=Math.min(Math.max(Number(req.query.limit)||100,1),300);
  const country=req.query.country_code?String(req.query.country_code).toUpperCase():null;
  const region=String(req.query.region||'').toUpperCase();
  const category=req.query.category?String(req.query.category):null;
  const since=String(req.query.since_minutes||60);
  const params=[req.user.org_id,Number.isFinite(Number(since))?Number(since):60,country,category];
  let scopeSql='';
  if(country==='KE') {
    // Kenya: country code + conservative coordinate sanity fence.
    scopeSql=`AND a.country_code='KE' AND (a.latitude IS NULL OR (a.latitude BETWEEN -5.5 AND 5.5 AND a.longitude BETWEEN 33.5 AND 42.5))`;
  } else if(region==='EA') {
    // East Africa: explicit country allow-list; no accidental global fallback.
    params.push(EAST_AFRICA);
    scopeSql=`AND a.country_code=ANY($5::text[])`;
  }
  params.push(limit);
  const limitParam=params.length;
  const {rows}=await req.db(`SELECT a.*,s.name AS source_name,s.provider,io.url AS source_url,io.body AS source_text FROM intel_alerts a LEFT JOIN intel_sources s ON s.id=a.source_id LEFT JOIN intel_observations io ON io.id=a.observation_id WHERE a.org_id=$1 AND a.last_seen_at>=now()-make_interval(mins => LEAST(GREATEST($2::int,1),1440)) AND ($3::text IS NULL OR a.country_code=$3) AND ($4::text IS NULL OR a.category=$4) ${scopeSql} ORDER BY a.last_seen_at DESC LIMIT $${limitParam}`,[...params]);
  res.json({alerts:rows,generated_at:new Date().toISOString(),freshness_window_minutes:Number(since),geographic_scope:country||region||'global'});
}));

router.get('/status', asyncHandler(async (req,res)=>{
  const {rows:[summary]}=await req.db(`SELECT COUNT(*)::int AS alerts_24h,COUNT(*) FILTER(WHERE last_seen_at>=now()-interval '60 minutes')::int AS alerts_60m,COUNT(*) FILTER(WHERE verification_state='unverified')::int AS unverified,COUNT(*) FILTER(WHERE severity IN ('critical','high'))::int AS priority,COUNT(DISTINCT source_id)::int AS sources,MAX(last_seen_at) AS latest_alert FROM intel_alerts WHERE org_id=$1 AND last_seen_at>=now()-interval '24 hours'`,[req.user.org_id]);
  const {rows:categories}=await req.db(`SELECT category,COUNT(*)::int AS count FROM intel_alerts WHERE org_id=$1 AND last_seen_at>=now()-interval '24 hours' GROUP BY category ORDER BY count DESC`,[req.user.org_id]);
  res.json({status:{...summary,categories,checked_at:new Date().toISOString()}});
}));

router.get('/:id', asyncHandler(async (req,res)=>{
  const {rows}=await req.db(`SELECT a.*,s.name AS source_name,s.provider,io.url AS source_url,io.body AS source_text,io.raw_metadata FROM intel_alerts a LEFT JOIN intel_sources s ON s.id=a.source_id LEFT JOIN intel_observations io ON io.id=a.observation_id WHERE a.org_id=$1 AND a.id=$2 LIMIT 1`,[req.user.org_id,req.params.id]);
  if(!rows[0])return res.status(404).json({error:'Alert not found'});
  res.json({alert:rows[0]});
}));

module.exports=router;