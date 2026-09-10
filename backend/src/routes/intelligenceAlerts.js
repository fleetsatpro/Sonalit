const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');

router.use(authenticate, attachOrgDb);

const EAST_AFRICA_CODES = ['KE','TZ','UG','RW','BI','SS','ET','SO','CD','SD'];

function scopeClause(scope,country){
  if(scope==='EA') return {sql:`a.country_code = ANY($3::text[])`,value:EAST_AFRICA_CODES};
  if(country) return {sql:`a.country_code = $3`,value:country};
  return {sql:'TRUE',value:null};
}

router.get('/', asyncHandler(async (req,res)=>{
  const limit=Math.min(Math.max(Number(req.query.limit)||250,1),500);
  const country=req.query.country_code?String(req.query.country_code).toUpperCase():null;
  const scope=String(req.query.scope||'').toUpperCase();
  const category=req.query.category?String(req.query.category):null;
  const since=Number.isFinite(Number(req.query.since_minutes))?Math.min(Math.max(Number(req.query.since_minutes),1),1440):180;
  const scoped=scopeClause(scope,country);
  const params=[req.user.org_id,since,scoped.value,category,limit];
  const {rows}=await req.db(`SELECT a.*,s.name AS source_name,s.provider,io.url AS source_url,io.body AS source_text FROM intel_alerts a LEFT JOIN intel_sources s ON s.id=a.source_id LEFT JOIN intel_observations io ON io.id=a.observation_id WHERE a.org_id=$1 AND a.last_seen_at>=now()-make_interval(mins => $2::int) AND ${scoped.sql} AND ($4::text IS NULL OR a.category=$4) ORDER BY a.last_seen_at DESC LIMIT $5`,params);
  res.json({alerts:rows,generated_at:new Date().toISOString(),freshness_window_minutes:since,scope:scope==='EA'?'EAST_AFRICA':country||'GLOBAL'});
}));

router.get('/status', asyncHandler(async (req,res)=>{
  const country=req.query.country_code?String(req.query.country_code).toUpperCase():null;
  const scope=String(req.query.scope||'').toUpperCase();
  const scoped=scopeClause(scope,country);
  const {rows:[summary]}=await req.db(`SELECT COUNT(*)::int AS alerts_24h,COUNT(*) FILTER(WHERE last_seen_at>=now()-interval '60 minutes')::int AS alerts_60m,COUNT(*) FILTER(WHERE verification_state='unverified')::int AS unverified,COUNT(*) FILTER(WHERE severity IN ('critical','high'))::int AS priority,COUNT(DISTINCT source_id)::int AS sources,MAX(last_seen_at) AS latest_alert FROM intel_alerts a WHERE a.org_id=$1 AND a.last_seen_at>=now()-interval '24 hours' AND ${scoped.sql.replace(/\$3/g,'$2')}`,[req.user.org_id,scoped.value]);
  const {rows:categories}=await req.db(`SELECT category,COUNT(*)::int AS count FROM intel_alerts a WHERE a.org_id=$1 AND a.last_seen_at>=now()-interval '24 hours' AND ${scoped.sql.replace(/\$3/g,'$2')} GROUP BY category ORDER BY count DESC`,[req.user.org_id,scoped.value]);
  res.json({status:{...summary,categories,scope:scope==='EA'?'EAST_AFRICA':country||'GLOBAL',checked_at:new Date().toISOString()}});
}));

router.get('/:id', asyncHandler(async (req,res)=>{
  const {rows}=await req.db(`SELECT a.*,s.name AS source_name,s.provider,io.url AS source_url,io.body AS source_text,io.raw_metadata FROM intel_alerts a LEFT JOIN intel_sources s ON s.id=a.source_id LEFT JOIN intel_observations io ON io.id=a.observation_id WHERE a.org_id=$1 AND a.id=$2 LIMIT 1`,[req.user.org_id,req.params.id]);
  if(!rows[0])return res.status(404).json({error:'Alert not found'});
  res.json({alert:rows[0]});
}));

module.exports=router;
