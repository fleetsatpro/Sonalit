const router = require('express').Router();
const { asyncHandler } = require('../middleware/error');

// Admin/auth/org middleware is inherited from /risk/intelligence.
const priorityRank = `CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END`;

router.get('/gaps', asyncHandler(async (req,res) => {
  const status=req.query.status||null;
  const {rows}=await req.db(`SELECT * FROM intel_gaps WHERE ($1::text IS NULL OR status=$1) ORDER BY ${priorityRank},created_at DESC LIMIT 300`,[status]);
  res.json({gaps:rows,generated_at:new Date().toISOString()});
}));

router.post('/gaps', asyncHandler(async(req,res)=>{
  const {gap_type,title,description,scope_type,scope_key,priority,recommended_action,evidence,due_at}=req.body||{};
  if(!gap_type||!title||!scope_type)return res.status(400).json({error:'gap_type, title and scope_type are required'});
  const {rows}=await req.db(`INSERT INTO intel_gaps (org_id,gap_type,title,description,scope_type,scope_key,priority,recommended_action,evidence,due_at,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[req.user.org_id,gap_type,title,description||null,scope_type,scope_key||null,priority||'medium',recommended_action||null,evidence||[],due_at||null,req.user.id]);
  res.status(201).json({gap:rows[0]});
}));

router.patch('/gaps/:id', asyncHandler(async(req,res)=>{
  const allowed=['title','description','priority','status','recommended_action','evidence','due_at'];
  const sets=[],vals=[];
  for(const f of allowed)if(Object.prototype.hasOwnProperty.call(req.body||{},f)){vals.push(req.body[f]);sets.push(`${f}=$${vals.length}`)}
  if(req.body?.status==='resolved'){vals.push(new Date());sets.push(`resolved_at=$${vals.length}`);vals.push(req.user.id);sets.push(`resolved_by=$${vals.length}`)}
  if(!sets.length)return res.status(400).json({error:'No valid fields to update'});
  vals.push(req.params.id,req.user.org_id);
  const {rows}=await req.db(`UPDATE intel_gaps SET ${sets.join(',')},updated_at=now() WHERE id=$${vals.length-1} AND org_id=$${vals.length} RETURNING *`,vals);
  if(!rows.length)return res.status(404).json({error:'Gap not found'});
  res.json({gap:rows[0]});
}));

router.get('/storylines', asyncHandler(async(req,res)=>{
  const {rows}=await req.db(`SELECT s.*,COUNT(se.event_id)::int AS event_count FROM intel_storylines s LEFT JOIN intel_storyline_events se ON se.storyline_id=s.id WHERE ($1::text IS NULL OR s.status=$1) GROUP BY s.id ORDER BY s.updated_at DESC LIMIT 200`,[req.query.status||null]);
  res.json({storylines:rows,generated_at:new Date().toISOString()});
}));

router.get('/storylines/:id', asyncHandler(async(req,res)=>{
  const {rows}=await req.db(`SELECT s.*,COALESCE(json_agg(json_build_object('event_id',e.id,'sequence_no',se.sequence_no,'relationship',se.relationship,'title',e.title,'summary',e.summary,'severity',e.severity,'confidence',e.confidence,'occurred_from',e.occurred_from,'occurred_to',e.occurred_to) ORDER BY se.sequence_no,e.occurred_from) FILTER(WHERE e.id IS NOT NULL),'[]') AS events FROM intel_storylines s LEFT JOIN intel_storyline_events se ON se.storyline_id=s.id LEFT JOIN intel_events e ON e.id=se.event_id WHERE s.id=$1 AND s.org_id=$2 GROUP BY s.id`,[req.params.id,req.user.org_id]);
  if(!rows.length)return res.status(404).json({error:'Storyline not found'});res.json({storyline:rows[0]});
}));

router.post('/storylines', asyncHandler(async(req,res)=>{
  const {reference,title,summary,severity,scope_type,scope_key,assessment}=req.body||{};
  if(!title)return res.status(400).json({error:'title is required'});
  const ref=reference||`STL-${Date.now().toString(36).toUpperCase()}`;
  const {rows}=await req.db(`INSERT INTO intel_storylines (org_id,reference,title,summary,severity,scope_type,scope_key,assessment,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[req.user.org_id,ref,title,summary||null,severity||'moderate',scope_type||'global',scope_key||null,assessment||null,req.user.id]);
  res.status(201).json({storyline:rows[0]});
}));

router.post('/storylines/:id/events', asyncHandler(async(req,res)=>{
  const {event_id,sequence_no,relationship}=req.body||{};if(!event_id)return res.status(400).json({error:'event_id is required'});
  const {rows}=await req.db(`INSERT INTO intel_storyline_events (storyline_id,event_id,sequence_no,relationship) SELECT $1,$2,$3,$4 WHERE EXISTS(SELECT 1 FROM intel_storylines WHERE id=$1 AND org_id=$5) AND EXISTS(SELECT 1 FROM intel_events WHERE id=$2 AND org_id=$5) ON CONFLICT(storyline_id,event_id) DO UPDATE SET sequence_no=EXCLUDED.sequence_no,relationship=EXCLUDED.relationship RETURNING *`,[req.params.id,event_id,sequence_no||0,relationship||'develops',req.user.org_id]);
  if(!rows.length)return res.status(404).json({error:'Storyline or event not found'});res.status(201).json({link:rows[0]});
}));

router.get('/forecasts', asyncHandler(async(req,res)=>{
  const scope=req.query.scope_type||null;
  const {rows}=await req.db(`SELECT * FROM intel_forecasts WHERE ($1::text IS NULL OR scope_type=$1) AND status<>'expired' ORDER BY valid_until ASC NULLS LAST,created_at DESC LIMIT 300`,[scope]);
  res.json({forecasts:rows,generated_at:new Date().toISOString()});
}));

router.post('/forecasts', asyncHandler(async(req,res)=>{
  const {scope_type,scope_key,horizon,scenario,probability,confidence,judgement,assumptions,indicators,invalidation_triggers,evidence,valid_until}=req.body||{};
  if(!scope_type||!horizon||!scenario||!judgement)return res.status(400).json({error:'scope_type, horizon, scenario and judgement are required'});
  const {rows}=await req.db(`INSERT INTO intel_forecasts (org_id,scope_type,scope_key,horizon,scenario,probability,confidence,judgement,assumptions,indicators,invalidation_triggers,evidence,valid_until,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[req.user.org_id,scope_type,scope_key||null,horizon,scenario,probability??null,confidence??50,judgement,assumptions||[],indicators||[],invalidation_triggers||[],evidence||[],valid_until||null,req.user.id]);
  res.status(201).json({forecast:rows[0]});
}));

router.post('/publications/:id/review', asyncHandler(async(req,res)=>{
  const {action,notes}=req.body||{};if(!['submit','approve','reject','withdraw','request_changes'].includes(action))return res.status(400).json({error:'Invalid review action'});
  const {rows:pub}=await req.db(`SELECT id,status FROM intel_publications WHERE id=$1 AND org_id=$2`,[req.params.id,req.user.org_id]);if(!pub.length)return res.status(404).json({error:'Publication not found'});
  const next={submit:'review',approve:'published',reject:'draft',withdraw:'withdrawn',request_changes:'draft'}[action];
  if(action==='approve'&&pub[0].status!=='review')return res.status(409).json({error:'Publication must be in review before approval'});
  const {rows}=await req.db(`INSERT INTO intel_publication_reviews (org_id,publication_id,action,reviewer_id,notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`,[req.user.org_id,req.params.id,action,req.user.id,notes||null]);
  await req.db(`UPDATE intel_publications SET status=$1,updated_at=now(),published_at=CASE WHEN $1='published' THEN now() ELSE published_at END,version=CASE WHEN $1 IN ('published','review') THEN version+1 ELSE version END WHERE id=$2 AND org_id=$3`,[next,req.params.id,req.user.org_id]);
  res.json({review:rows[0],status:next});
}));

router.get('/quality', asyncHandler(async(req,res)=>{
  const {rows:[q]}=await req.db(`SELECT COUNT(*)::int AS observations_30d,COUNT(DISTINCT source_id)::int AS sources_30d,ROUND(AVG(credibility))::int AS avg_credibility,ROUND(AVG(manipulation_score))::int AS avg_manipulation,COUNT(*) FILTER(WHERE manipulation_score>=40)::int AS manipulation_flags FROM intel_observations WHERE observed_at>=now()-interval '30 days'`);
  const {rows:[e]}=await req.db(`SELECT COUNT(*)::int AS events_30d,ROUND(AVG(confidence))::int AS avg_event_confidence,COUNT(*) FILTER(WHERE severity IN ('critical','high'))::int AS high_critical_events FROM intel_events WHERE last_seen_at>=now()-interval '30 days'`);
  const {rows:[g]}=await req.db(`SELECT COUNT(*) FILTER(WHERE status IN ('open','tasked','monitoring'))::int AS open_gaps,COUNT(*) FILTER(WHERE status='resolved')::int AS resolved_gaps FROM intel_gaps`);
  res.json({quality:{...q,...e,...g,checked_at:new Date().toISOString()}});
}));

// Deep read surfaces for the Intelligence Centre. All reads are org-scoped through req.db/auth.
router.get('/events', asyncHandler(async(req,res)=>{
  const limit=Math.min(500,Math.max(1,Number(req.query.limit)||200));
  const severity=req.query.severity||null; const country=req.query.country_code||null; const status=req.query.status||null;
  const {rows}=await req.db(`SELECT e.*,COUNT(eo.observation_id)::int AS source_count FROM intel_events e LEFT JOIN intel_event_observations eo ON eo.event_id=e.id WHERE ($1::text IS NULL OR e.severity=$1) AND ($2::text IS NULL OR e.country_code=$2) AND ($3::text IS NULL OR e.status=$3) GROUP BY e.id ORDER BY e.last_seen_at DESC LIMIT $4`,[severity,country,status,limit]);
  res.json({events:rows,generated_at:new Date().toISOString()});
}));

router.get('/events/:id', asyncHandler(async(req,res)=>{
  const {rows}=await req.db(`SELECT e.*,COALESCE((SELECT json_agg(json_build_object('id',o.id,'title',o.title,'body',o.body,'url',o.url,'observed_at',o.observed_at,'credibility',o.credibility,'manipulation_score',o.manipulation_score,'relationship',eo.relationship,'weight',eo.weight,'source',json_build_object('id',s.id,'name',s.name,'source_type',s.source_type,'provider',s.provider,'reliability',s.reliability))) FROM intel_event_observations eo JOIN intel_observations o ON o.id=eo.observation_id LEFT JOIN intel_sources s ON s.id=o.source_id WHERE eo.event_id=e.id),'[]') AS evidence,COALESCE((SELECT json_agg(json_build_object('event_id',x.id,'title',x.title,'relationship',l.relationship,'confidence',l.confidence)) FROM intel_event_links l JOIN intel_events x ON x.id=CASE WHEN l.from_event_id=e.id THEN l.to_event_id ELSE l.from_event_id END WHERE l.from_event_id=e.id OR l.to_event_id=e.id),'[]') AS related_events FROM intel_events e WHERE e.id=$1 AND e.org_id=$2 GROUP BY e.id`,[req.params.id,req.user.org_id]);
  if(!rows.length)return res.status(404).json({error:'Event not found'}); res.json({event:rows[0]});
}));

router.get('/sources', asyncHandler(async(req,res)=>{
  const active=req.query.active==null?null:req.query.active==='true';
  const {rows}=await req.db(`SELECT s.*,COUNT(DISTINCT o.id)::int AS observation_count,MAX(o.observed_at) AS latest_observation FROM intel_sources s LEFT JOIN intel_observations o ON o.source_id=s.id WHERE ($1::boolean IS NULL OR s.active=$1) GROUP BY s.id ORDER BY s.last_seen_at DESC NULLS LAST,s.name LIMIT 300`,[active]);
  res.json({sources:rows,generated_at:new Date().toISOString()});
}));

router.get('/observations', asyncHandler(async(req,res)=>{
  const limit=Math.min(500,Math.max(1,Number(req.query.limit)||200));
  const {rows}=await req.db(`SELECT o.*,s.name AS source_name,s.source_type,s.provider FROM intel_observations o LEFT JOIN intel_sources s ON s.id=o.source_id ORDER BY o.observed_at DESC LIMIT $1`,[limit]);
  res.json({observations:rows,generated_at:new Date().toISOString()});
}));

router.get('/publications', asyncHandler(async(req,res)=>{
  const status=req.query.status||null;
  const {rows}=await req.db(`SELECT p.*,COUNT(r.id)::int AS review_count FROM intel_publications p LEFT JOIN intel_publication_reviews r ON r.publication_id=p.id WHERE ($1::text IS NULL OR p.status=$1) GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 300`,[status]);
  res.json({publications:rows,generated_at:new Date().toISOString()});
}));

router.get('/watchlists', asyncHandler(async(req,res)=>{
  const {rows}=await req.db(`SELECT w.* FROM intel_watchlists w WHERE w.active=true ORDER BY w.updated_at DESC LIMIT 300`);
  res.json({watchlists:rows,generated_at:new Date().toISOString()});
}));

router.get('/requirements', asyncHandler(async(req,res)=>{
  const status=req.query.status||null;
  const {rows}=await req.db(`SELECT * FROM intel_requirements WHERE ($1::text IS NULL OR status=$1) ORDER BY ${priorityRank},due_at ASC NULLS LAST,created_at DESC LIMIT 300`,[status]);
  res.json({requirements:rows,generated_at:new Date().toISOString()});
}));

router.get('/assessments', asyncHandler(async(req,res)=>{
  const scope=req.query.scope_type||null;
  const {rows}=await req.db(`SELECT * FROM intel_assessments WHERE ($1::text IS NULL OR scope_type=$1) AND (validity_end IS NULL OR validity_end>=now()) ORDER BY validity_start DESC LIMIT 300`,[scope]);
  res.json({assessments:rows,generated_at:new Date().toISOString()});
}));

router.get('/entities', asyncHandler(async(req,res)=>{
  const type=req.query.entity_type||null; const country=req.query.country_code||null;
  const {rows}=await req.db(`SELECT * FROM intel_entities WHERE ($1::text IS NULL OR entity_type=$1) AND ($2::text IS NULL OR country_code=$2) ORDER BY last_seen_at DESC LIMIT 500`,[type,country]);
  res.json({entities:rows,generated_at:new Date().toISOString()});
}));

router.get('/early-warnings', asyncHandler(async(req,res)=>{
  const {rows}=await req.db(`SELECT * FROM intel_early_warnings WHERE status IN ('open','review','acknowledged') ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'moderate' THEN 3 ELSE 4 END,last_detected_at DESC LIMIT 300`);
  res.json({warnings:rows,generated_at:new Date().toISOString()});
}));

module.exports=router;
