'use strict';
const express=require('express');
const Joi=require('joi');
const { pool }=require('../config/database');
const { authenticate,authorize }=require('../middleware/auth');
const { attachOrgDb }=require('../utils/orgScopedDb');
const { asyncHandler }=require('../middleware/error');
const { publish }=require('../realtime/centrifugo');
const { SCENARIOS,ACTIVE_EXCEPTION_STATUSES,TERMINAL_EXCEPTION_STATUSES,evaluateConvoyOperationalState }=require('../services/convoyOperationalResilience');
const router=express.Router();
router.use(authenticate,attachOrgDb);
router.get('/scenarios',authorize('admin','dispatcher','operator','analyst','cfo'),asyncHandler(async(_req,res)=>res.json({data:SCENARIOS})));
router.get('/:convoyId/state',authorize('admin','dispatcher','operator','analyst','cfo'),asyncHandler(async(req,res)=>{
  const state=await req.db('SELECT * FROM convoy_operational_states WHERE convoy_id=$1 AND org_id=$2',[req.params.convoyId,req.user.org_id]);
  const exceptions=await req.db("SELECT * FROM convoy_operational_exceptions WHERE convoy_id=$1 AND org_id=$2 AND status=ANY($3::text[]) ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,created_at DESC",[req.params.convoyId,req.user.org_id,ACTIVE_EXCEPTION_STATUSES]);
  const resources=await req.db('SELECT id,name,type,status,active,eta_minutes,base_lat,base_lng FROM response_teams WHERE org_id=$1 AND active=true ORDER BY name',[req.user.org_id]);
  if(!state.rows.length){const result=await evaluateConvoyOperationalState(req.db,req.user.org_id,req.params.convoyId);return res.json({data:{state:result.evaluation,exceptions:result.evaluation.exceptions,response_resources:result.evaluation.response_resources}});}
  res.json({data:{state:state.rows[0],exceptions:exceptions.rows,response_resources:resources.rows}});
}));
router.post('/:convoyId/evaluate',authorize('admin','dispatcher','operator','analyst','cfo'),asyncHandler(async(req,res)=>res.json({data:await evaluateConvoyOperationalState(req.db,req.user.org_id,req.params.convoyId)})));
const signalSchema=Joi.object({type:Joi.string().valid('vehicle_breakdown','mechanical_failure','security_event','checkpoint_delay','road_blockage','extended_stop').required(),severity:Joi.string().valid('low','medium','high','critical').default('high'),convoy_truck_id:Joi.string().uuid().allow(null),vehicle_id:Joi.string().uuid().allow(null),title:Joi.string().min(3).max(160).required(),detail:Joi.string().min(1).max(2000).required(),fingerprint:Joi.string().max(180).allow('',null),context:Joi.object().default({})});
router.post('/:convoyId/signals',authorize('admin','dispatcher','operator','cfo'),asyncHandler(async(req,res)=>{
  const {error,value}=signalSchema.validate(req.body,{abortEarly:false});if(error)return res.status(400).json({error:error.message});
  const convoy=await req.db('SELECT id FROM convoys WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL',[req.params.convoyId,req.user.org_id]);if(!convoy.rows.length)return res.status(404).json({error:'Convoy not found'});
  let vehicleId=value.vehicle_id||null;
  if(value.convoy_truck_id){const t=await req.db('SELECT id,vehicle_id FROM convoy_trucks WHERE id=$1 AND convoy_id=$2 AND org_id=$3',[value.convoy_truck_id,req.params.convoyId,req.user.org_id]);if(!t.rows.length)return res.status(404).json({error:'Convoy truck not found'});if(vehicleId&&String(vehicleId)!==String(t.rows[0].vehicle_id))return res.status(422).json({error:'vehicle_not_attached_to_convoy_truck'});vehicleId=vehicleId||t.rows[0].vehicle_id||null;}
  if(vehicleId){const v=await req.db('SELECT id FROM vehicles WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL',[vehicleId,req.user.org_id]);if(!v.rows.length)return res.status(404).json({error:'Vehicle not found'});}
  const fingerprint=value.fingerprint||('manual:'+value.type+':'+String(value.convoy_truck_id||'convoy')),type=value.type==='mechanical_failure'?'vehicle_breakdown':value.type;
  const ins=await req.db("INSERT INTO convoy_operational_exceptions(org_id,convoy_id,convoy_truck_id,vehicle_id,exception_type,severity,status,source,fingerprint,title,detail,context,recommended_actions,first_seen_at,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,'open','operator',$7,$8,$9,$10::jsonb,'[]'::jsonb,NOW(),NOW()) ON CONFLICT (convoy_id,fingerprint) WHERE status IN ('open','acknowledged','mitigating') DO UPDATE SET severity=EXCLUDED.severity,title=EXCLUDED.title,detail=EXCLUDED.detail,context=EXCLUDED.context,last_seen_at=NOW(),updated_at=NOW() RETURNING *",[req.user.org_id,req.params.convoyId,value.convoy_truck_id||null,vehicleId,type,value.severity,fingerprint,value.title,value.detail,JSON.stringify({signal_source:'operator',created_by:req.user.id,...value.context})]);
  publish('org#'+req.user.org_id,{type:'convoy.operational.signal',convoyId:req.params.convoyId,exceptionId:ins.rows[0].id,exceptionType:ins.rows[0].exception_type,severity:ins.rows[0].severity});
  res.status(201).json({data:await evaluateConvoyOperationalState(req.db,req.user.org_id,req.params.convoyId)});
}));
const statusSchema=Joi.object({status:Joi.string().valid('open','acknowledged','mitigating','resolved','waived').required(),resolution_note:Joi.string().max(2000).allow('',null)});
router.patch('/:convoyId/exceptions/:exceptionId',authorize('admin','dispatcher','operator','cfo'),asyncHandler(async(req,res)=>{
  const {error,value}=statusSchema.validate(req.body);if(error)return res.status(400).json({error:error.message});
  const row=await req.db('SELECT * FROM convoy_operational_exceptions WHERE id=$1 AND convoy_id=$2 AND org_id=$3',[req.params.exceptionId,req.params.convoyId,req.user.org_id]);if(!row.rows.length)return res.status(404).json({error:'Operational exception not found'});
  if(TERMINAL_EXCEPTION_STATUSES.includes(row.rows[0].status)&&!TERMINAL_EXCEPTION_STATUSES.includes(value.status))return res.status(409).json({error:'terminal_exception_cannot_reopen_directly'});
  const u=await req.db("UPDATE convoy_operational_exceptions SET status=$1,resolved_at=CASE WHEN $1 IN ('resolved','waived') THEN NOW() ELSE NULL END,resolved_by=CASE WHEN $1 IN ('resolved','waived') THEN $4 ELSE NULL END,resolution_note=COALESCE($5,resolution_note),updated_at=NOW() WHERE id=$2 AND convoy_id=$3 AND org_id=$6 RETURNING *",[value.status,req.params.exceptionId,req.params.convoyId,req.user.id,value.resolution_note||null,req.user.org_id]);
  publish('org#'+req.user.org_id,{type:'convoy.operational.exception',convoyId:req.params.convoyId,exceptionId:u.rows[0].id,status:u.rows[0].status});res.json({data:u.rows[0]});
}));
const reassignSchema=Joi.object({convoy_truck_id:Joi.string().uuid().required(),to_cfo_user_id:Joi.string().uuid().required(),from_cfo_user_id:Joi.string().uuid().allow(null)});
router.post('/:convoyId/coverage/reassign',authorize('admin','dispatcher','operator'),asyncHandler(async(req,res)=>{
  const {error,value}=reassignSchema.validate(req.body);if(error)return res.status(400).json({error:error.message});
  const c=await pool.connect();
  try{
    await c.query('BEGIN');await c.query('SET LOCAL ROLE sonalit_app');await c.query('SELECT set_config($1,$2,true)',['app.current_org_id',req.user.org_id]);
    const cv=await c.query('SELECT id FROM convoys WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL FOR UPDATE',[req.params.convoyId,req.user.org_id]);if(!cv.rows.length){await c.query('ROLLBACK');return res.status(404).json({error:'Convoy not found'});}
    const tr=await c.query('SELECT id FROM convoy_trucks WHERE id=$1 AND convoy_id=$2 AND org_id=$3 FOR UPDATE',[value.convoy_truck_id,req.params.convoyId,req.user.org_id]);if(!tr.rows.length){await c.query('ROLLBACK');return res.status(404).json({error:'Convoy truck not found'});}
    const target=await c.query("SELECT id,role FROM users WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL",[value.to_cfo_user_id,req.user.org_id]);if(!target.rows.length||target.rows[0].role!=='cfo'){await c.query('ROLLBACK');return res.status(422).json({error:'target_user_must_be_cfo_in_same_org'});}
    const member=await c.query('SELECT id FROM convoy_cfos WHERE convoy_id=$1 AND cfo_user_id=$2',[req.params.convoyId,value.to_cfo_user_id]);if(!member.rows.length){await c.query('ROLLBACK');return res.status(422).json({error:'target_cfo_not_assigned_to_convoy'});}
    const cur=await c.query('SELECT id,cfo_user_id FROM convoy_cfo_truck_assignments WHERE convoy_id=$1 AND convoy_truck_id=$2 FOR UPDATE',[req.params.convoyId,value.convoy_truck_id]);if(value.from_cfo_user_id&&cur.rows[0]&&String(cur.rows[0].cfo_user_id)!==String(value.from_cfo_user_id)){await c.query('ROLLBACK');return res.status(409).json({error:'current_cfo_assignment_changed'});}
    if(cur.rows[0]&&String(cur.rows[0].cfo_user_id)===String(value.to_cfo_user_id)){await c.query('COMMIT');return res.json({data:{reassigned:false,cfo_user_id:value.to_cfo_user_id}});}
    const count=await c.query('SELECT COUNT(*)::int count FROM convoy_cfo_truck_assignments WHERE convoy_id=$1 AND cfo_user_id=$2',[req.params.convoyId,value.to_cfo_user_id]);if(Number(count.rows[0].count)>=2){await c.query('ROLLBACK');return res.status(409).json({error:'target_cfo_truck_limit_reached'});}
    if(cur.rows[0])await c.query('DELETE FROM convoy_cfo_truck_assignments WHERE id=$1',[cur.rows[0].id]);
    await c.query('INSERT INTO convoy_cfo_truck_assignments(convoy_id,cfo_user_id,convoy_truck_id) VALUES($1,$2,$3)',[req.params.convoyId,value.to_cfo_user_id,value.convoy_truck_id]);
    await c.query("INSERT INTO convoy_operational_actions(org_id,convoy_id,action_type,status,convoy_truck_id,cfo_user_id,actor_user_id,metadata,completed_at) VALUES($1,$2,'reassign_backup_cfo','executed',$3,$4,$5,$6::jsonb,NOW())",[req.user.org_id,req.params.convoyId,value.convoy_truck_id,value.to_cfo_user_id,req.user.id,JSON.stringify({from_cfo_user_id:cur.rows[0]?.cfo_user_id||null})]);
    await c.query('COMMIT');
  }catch(e){try{await c.query('ROLLBACK')}catch(_){}if(e.message?.includes('cfo_truck_limit_exceeded'))return res.status(409).json({error:'target_cfo_truck_limit_reached'});throw e}finally{c.release()}
  publish('org#'+req.user.org_id,{type:'convoy.operational.action',convoyId:req.params.convoyId,actionType:'reassign_backup_cfo',convoyTruckId:value.convoy_truck_id,cfoUserId:value.to_cfo_user_id,actorUserId:req.user.id});
  res.json({data:await evaluateConvoyOperationalState(req.db,req.user.org_id,req.params.convoyId)});
}));
const dispatchSchema=Joi.object({team_id:Joi.string().uuid().required(),response_type:Joi.string().valid('mobile_response','recovery','static_guard').required(),convoy_truck_id:Joi.string().uuid().allow(null),target_lat:Joi.number().min(-90).max(90).allow(null),target_lng:Joi.number().min(-180).max(180).allow(null),reason:Joi.string().min(5).max(1000).required(),priority:Joi.string().valid('critical','high','medium').default('high')});
router.post('/:convoyId/exceptions/:exceptionId/dispatch',authorize('admin','dispatcher','operator'),asyncHandler(async(req,res)=>{
  const {error,value}=dispatchSchema.validate(req.body);if(error)return res.status(400).json({error:error.message});
  const c=await pool.connect();
  try{
    await c.query('BEGIN');await c.query('SET LOCAL ROLE sonalit_app');await c.query('SELECT set_config($1,$2,true)',['app.current_org_id',req.user.org_id]);
    const ex=await c.query('SELECT * FROM convoy_operational_exceptions WHERE id=$1 AND convoy_id=$2 AND org_id=$3 AND status=ANY($4::text[]) FOR UPDATE',[req.params.exceptionId,req.params.convoyId,req.user.org_id,ACTIVE_EXCEPTION_STATUSES]);if(!ex.rows.length){await c.query('ROLLBACK');return res.status(404).json({error:'Active operational exception not found'});}
    const team=await c.query('SELECT id,name,callsign,type,status FROM response_teams WHERE id=$1 AND org_id=$2 AND active=true FOR UPDATE',[value.team_id,req.user.org_id]);if(!team.rows.length){await c.query('ROLLBACK');return res.status(404).json({error:'Response team not found'});}if(team.rows[0].status!=='standby'){await c.query('ROLLBACK');return res.status(409).json({error:'response_team_not_standby'});}
    const actual=String(team.rows[0].type||'').toLowerCase(),accepted=value.response_type==='mobile_response'?['mobile_response','reaction','armed_response']:[value.response_type];if(!accepted.includes(actual)){await c.query('ROLLBACK');return res.status(422).json({error:'response_team_type_mismatch',required:value.response_type,actual});}
    let vehicleId=ex.rows[0].vehicle_id||null,lat=value.target_lat,lng=value.target_lng;
    if(value.convoy_truck_id){const tr=await c.query('SELECT id,vehicle_id FROM convoy_trucks WHERE id=$1 AND convoy_id=$2 AND org_id=$3 FOR UPDATE',[value.convoy_truck_id,req.params.convoyId,req.user.org_id]);if(!tr.rows.length){await c.query('ROLLBACK');return res.status(404).json({error:'Convoy truck not found'});}vehicleId=tr.rows[0].vehicle_id||vehicleId;}
    if(vehicleId&&!value.convoy_truck_id){const m=await c.query('SELECT id FROM convoy_trucks WHERE convoy_id=$1 AND vehicle_id=$2 AND org_id=$3',[req.params.convoyId,vehicleId,req.user.org_id]);if(!m.rows.length){await c.query('ROLLBACK');return res.status(422).json({error:'vehicle_not_attached_to_convoy'});}}
    if(lat==null||lng==null){if(!vehicleId){await c.query('ROLLBACK');return res.status(422).json({error:'target_coordinates_required'});}const p=await c.query('SELECT latitude lat,longitude lng FROM vehicles WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL',[vehicleId,req.user.org_id]);lat=p.rows[0]?.lat!=null?Number(p.rows[0].lat):null;lng=p.rows[0]?.lng!=null?Number(p.rows[0].lng):null;}
    if(lat==null||lng==null){await c.query('ROLLBACK');return res.status(422).json({error:'target_coordinates_required'});}
    const dup=await c.query("SELECT id FROM intercept_dispatches WHERE team_id=$1 AND org_id=$2 AND status IN('dispatched','acknowledged','en_route','on_scene') LIMIT 1 FOR UPDATE",[value.team_id,req.user.org_id]);if(dup.rows.length){await c.query('ROLLBACK');return res.status(409).json({error:'response_team_has_active_dispatch',dispatch_id:dup.rows[0].id});}
    const d=await c.query("INSERT INTO intercept_dispatches(org_id,team_id,convoy_id,vehicle_id,priority,status,reason,target_lat,target_lng,target_label,dispatched_by) VALUES($1,$2,$3,$4,$5,'dispatched',$6,$7,$8,$9,$10) RETURNING *",[req.user.org_id,value.team_id,req.params.convoyId,vehicleId,value.priority,value.reason,lat,lng,team.rows[0].callsign||team.rows[0].name,req.user.id]);
    await c.query("UPDATE response_teams SET status='deployed',updated_at=NOW() WHERE id=$1 AND org_id=$2",[value.team_id,req.user.org_id]);
    await c.query("UPDATE convoy_operational_exceptions SET status='mitigating',last_seen_at=NOW(),updated_at=NOW() WHERE id=$1 AND org_id=$2",[ex.rows[0].id,req.user.org_id]);
    const actionType=value.response_type==='recovery'?'dispatch_recovery':value.response_type==='static_guard'?'deploy_static_guard':'dispatch_mobile_response';
    await c.query("INSERT INTO convoy_operational_actions(org_id,convoy_id,exception_id,action_type,status,convoy_truck_id,response_team_id,dispatch_id,actor_user_id,metadata) VALUES($1,$2,$3,$4,'executed',$5,$6,$7,$8,$9::jsonb)",[req.user.org_id,req.params.convoyId,ex.rows[0].id,actionType,value.convoy_truck_id||ex.rows[0].convoy_truck_id||null,value.team_id,d.rows[0].id,req.user.id,JSON.stringify({response_type:value.response_type,reason:value.reason})]);
    await c.query('COMMIT');
    publish('org#'+req.user.org_id,{type:'convoy.operational.action',convoyId:req.params.convoyId,exceptionId:ex.rows[0].id,actionType,dispatchId:d.rows[0].id,responseTeamId:value.team_id});
    res.status(201).json({data:{dispatch:d.rows[0],resilience:await evaluateConvoyOperationalState(req.db,req.user.org_id,req.params.convoyId)}});
  }catch(e){try{await c.query('ROLLBACK')}catch(_){}throw e}finally{c.release()}
}));
module.exports=router;