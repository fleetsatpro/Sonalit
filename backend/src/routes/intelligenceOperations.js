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

module.exports=router;
