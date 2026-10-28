'use strict';
const sjmRouter = require('../src/routes/secureJourneyManagement');
const { authenticate } = require('../src/middleware/auth');
const { validCoordinate, validateStop, validateJourney, validateServiceDetails, dutyEventAllowed, isMobilityManager, canAccessJourney, canAccessReport, lifecycleAuthorityError, isInternalOperationalEvent, isClientSafeEvent, classificationForGenericEvent, eventVisibleToDuty, journeyForViewer, journeyForDutyViewer, approvalGate, dateInTimezone, validDateOnly, csvCell, toCsv, lifecycleTransition, dailyReportSchedulerAvailable, mutateWithEvent, recordRouteAssessmentFailure, freshnessFor, latestObservedAt, telemetryFor, readinessChecklist, changeEventsFor, managementSummaryCounts, lockJourneyForMobility, routeAssessmentUsable, REPORT_TYPES, REPORT_TITLES, eventsForReport, planRequestPolicyError, enabledReportSections, reportFocusSections } = sjmRouter.__test;
const { configuredOrgIds, shouldGenerateForToday } = require('../src/services/sjmDailyReportScheduler');
describe('SJM validation and evidence boundaries', () => {
  test('redacts private principal and meet-and-greet details from unassigned viewers', () => {
    const journey={id:'journey-1',principal_reference:'VIP-42',flight_status_note:'Private airline call',meet_greet_instructions:'Use private entrance'};
    const events=[
      {id:'1',detail:{classification:'INTERNAL_OPERATIONS',note:'CPO only'}},
      {id:'2',detail:{classification:'CLIENT_SAFE',note:'Public arrival'}},
      {id:'3',detail:{note:'Unclassified legacy entry must not be published'}}
    ];
    const safe=journeyForViewer(journey,events,false);
    expect(safe.principal_reference).toBeNull();
    expect(safe.flight_status_note).toBeNull();
    expect(safe.meet_greet_instructions).toBeNull();
    expect(safe.events.map(e=>e.id)).toEqual(['2']);
    expect(isClientSafeEvent(events[1])).toBe(true);
    expect(isClientSafeEvent(events[2])).toBe(false);
    expect(journeyForViewer(journey,events,true).events).toHaveLength(3);
    expect(isInternalOperationalEvent(events[0])).toBe(true);
    expect(isInternalOperationalEvent(events[1])).toBe(false);
    expect(isClientSafeEvent(events[1])).toBe(true);
  });
  test('redacts mission details and event notes by assigned duty, while retaining relevant operational context', () => {
    const journey={principal_reference:'PRINCIPAL-17',airport_code:'NBO',terminal:'1A',airline:'KQ',flight_number:'KQ 100',flight_scheduled_at:'2026-10-29T08:00:00Z',flight_status:'delayed',flight_status_source:'operator_entered',flight_status_note:'Sensitive airline and arrival handling note',meet_greet_instructions:'Use the east-side VIP entrance'};
    const internal={id:'e1',detail:{classification:'INTERNAL_OPERATIONS',duty_roles:['meet_greet'],note:'Sensitive pickup detail'}};
    const clientSafe={id:'e2',detail:{classification:'CLIENT_SAFE',note:'Client-safe update'}};
    const unclassified={id:'e3',detail:{note:'Legacy entry without classification'}};
    const driver=journeyForDutyViewer(journey,[internal,clientSafe,unclassified],{role:'operator'},['driver']);
    expect(driver.principal_reference).toBe('PRINCIPAL-17');
    expect(driver.flight_status_note).toBeNull();
    expect(driver.meet_greet_instructions).toBeNull();
    expect(driver.events.map(e=>e.id)).toEqual(['e2']);
    const greeter=journeyForDutyViewer(journey,[internal,clientSafe,unclassified],{role:'operator'},['meet_greet']);
    expect(greeter.meet_greet_instructions).toBe('Use the east-side VIP entrance');
    expect(greeter.flight_status_note).toBe('Sensitive airline and arrival handling note');
    expect(greeter.events.map(e=>e.id)).toEqual(['e1','e2']);
    expect(eventVisibleToDuty(internal,{role:'operator'},['meet_greet'])).toBe(true);
    expect(eventVisibleToDuty(internal,{role:'operator'},['driver'])).toBe(false);
    expect(eventVisibleToDuty(unclassified,{role:'operator'},['driver'])).toBe(false);
    expect(eventVisibleToDuty(unclassified,{role:'dispatcher'},[])).toBe(true);
  });
  test('validates executive mobility metadata and rejects caller-forged flight state', () => {
    expect(validateServiceDetails({service_type:'airport_arrival',airport_code:'NBO',flight_number:'KQ 100'})).toBeNull();
    expect(validateServiceDetails({service_type:'executive_transfer'})).toBeNull();
    expect(validateServiceDetails({service_type:'airport_arrival',airport_code:'Nairobi'})).toMatch(/Airport code/);
    expect(validateServiceDetails({service_type:'unsupported'})).toMatch(/Service type/);
    expect(validateServiceDetails({flight_status:'landed'})).toMatch(/operator-status endpoint/);
    expect(validateServiceDetails({flight_scheduled_at:'not-a-time'})).toMatch(/Scheduled flight time/);
  });
  test('restricts field check-ins to allowed assigned duty roles', () => {
    expect(dutyEventAllowed(['driver'],'driver_at_pickup')).toBe(true);
    expect(dutyEventAllowed(['driver'],'principal_met')).toBe(false);
    expect(dutyEventAllowed(['cpo'],'security_concern')).toBe(true);
    expect(dutyEventAllowed(['meet_greet'],'handover_to_cpo')).toBe(true);
    expect(dutyEventAllowed(['dispatcher'],'incident')).toBe(true);
    expect(dutyEventAllowed(['analyst'],'incident')).toBe(false);
  });
  test('limits mission management to operational roles', () => {
    expect(isMobilityManager({role:'dispatcher'})).toBe(true);
    expect(isMobilityManager({role:'admin'})).toBe(true);
    expect(isMobilityManager({role:'operator'})).toBe(false);
    expect(isMobilityManager({role:'analyst'})).toBe(false);
    expect(isMobilityManager({role:'driver'})).toBe(false);
  });
  test('scopes all itinerary and report snapshots to assigned personnel or dispatch management', () => {
    expect(canAccessJourney({role:'admin'},[])).toBe(true);
    expect(canAccessJourney({role:'dispatcher'},[])).toBe(true);
    expect(canAccessJourney({role:'operator'},[])).toBe(false);
    expect(canAccessJourney({role:'analyst'},[])).toBe(false);
    expect(canAccessJourney({role:'operator'},['driver'])).toBe(true);
    expect(canAccessJourney({role:'analyst'},['cpo'])).toBe(true);
    expect(canAccessReport({role:'operator'},{journey_id:'mission-1'},[])).toBe(false);
    expect(canAccessReport({role:'operator'},{journey_id:'mission-1'},['driver'])).toBe(true);
    expect(canAccessReport({role:'analyst'},{journey_id:null},[])).toBe(false);
    expect(canAccessReport({role:'dispatcher'},{journey_id:null},[])).toBe(true);
    expect(canAccessReport({role:'operator'},null,[])).toBe(false);
  });
  test('enforces lifecycle authority by account role and assigned duty', () => {
    expect(lifecycleAuthorityError({role:'operator'},['driver'],'ready_to_depart')).toMatchObject({error:'dispatcher_authority_required'});
    expect(lifecycleAuthorityError({role:'dispatcher'},[],'ready_to_depart')).toBeNull();
    expect(lifecycleAuthorityError({role:'operator'},['meet_greet'],'start')).toMatchObject({error:'driver_authority_required'});
    expect(lifecycleAuthorityError({role:'operator'},['backup_driver'],'start')).toBeNull();
    expect(lifecycleAuthorityError({role:'operator'},['meet_greet'],'pause')).toMatchObject({error:'field_duty_required'});
    expect(lifecycleAuthorityError({role:'operator'},['cpo'],'raise_exception')).toBeNull();
    expect(lifecycleAuthorityError({role:'operator'},['driver'],'hold')).toMatchObject({error:'dispatcher_authority_required'});
    expect(lifecycleAuthorityError({role:'admin'},[],'hold')).toBeNull();
  });
  test('classifies generic mission log entries before report publication', () => {
    expect(classificationForGenericEvent('operator_note')).toBe('INTERNAL_OPERATIONS');
    expect(classificationForGenericEvent('security_update')).toBe('INTERNAL_OPERATIONS');
    expect(classificationForGenericEvent('delay')).toBe('INTERNAL_OPERATIONS');
    expect(classificationForGenericEvent('incident')).toBe('INTERNAL_OPERATIONS');
    expect(classificationForGenericEvent('client_update')).toBe('CLIENT_SAFE');
  });
  test('authenticates requests before the tenant-scope guard', () => {
    const authIndex = sjmRouter.stack.findIndex(layer => layer.handle === authenticate);
    expect(authIndex).toBeGreaterThanOrEqual(0);
    const firstRouteIndex = sjmRouter.stack.findIndex(layer => Boolean(layer.route));
    expect(firstRouteIndex).toBeGreaterThan(authIndex);
  });
  const valid = { title:'Nairobi to Mombasa security movement', purpose:'Client-approved escorted road movement', origin_label:'Nairobi', origin_lat:-1.286389, origin_lng:36.817223, destination_label:'Mombasa', destination_lat:-4.043477, destination_lng:39.668206, planned_departure_at:'2026-10-28T06:00:00+03:00', planned_arrival_at:'2026-10-28T16:00:00+03:00', transport_mode:'road', stops:[{name:'Voi checkpoint',stop_type:'checkpoint',lat:-3.396,lng:38.556}] };
  test('locks the tenant-scoped journey row before mutation decisions', async () => {
    const calls=[];
    const db=async(sql,params)=>{
      calls.push({sql,params});
      return {rows:[{id:'journey-1',status:'in_progress',flight_number:'KQ 100',flight_status:'scheduled'}]};
    };
    const locked=await lockJourneyForMobility(db,'org-1','journey-1');
    expect(locked).toMatchObject({id:'journey-1',status:'in_progress',flight_number:'KQ 100'});
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL FOR UPDATE');
    expect(calls[0].params).toEqual(['journey-1','org-1']);
  });

  test('keeps daily report generation tenant-allowlisted and respects client-local time', () => {
    const org='12345678-1234-4234-8234-123456789abc';
    expect(configuredOrgIds('')).toEqual([]);
    expect(configuredOrgIds(' '+org.toUpperCase()+', '+org+' ')).toEqual([org]);
    expect(configuredOrgIds('00000000-0000-0000-0000-000000000001')).toEqual(['00000000-0000-0000-0000-000000000001']);
    expect(()=>configuredOrgIds('not-a-uuid')).toThrow(/invalid UUID/);
    expect(dailyReportSchedulerAvailable(org)).toBe(configuredOrgIds().includes(org));
    expect(shouldGenerateForToday(new Date('2026-10-27T14:59:00Z'),'18:00','Africa/Nairobi')).toBe(false);
    expect(shouldGenerateForToday(new Date('2026-10-27T15:00:00Z'),'18:00','Africa/Nairobi')).toBe(true);
    expect(shouldGenerateForToday(new Date('2026-10-27T15:00:00Z'),'18:00','Mars/Nowhere')).toBe(false);
  });

  test('selects latest telemetry by instant rather than Date.toString() ordering', () => {
    const latest = new Date('2026-10-25T21:00:00.000Z'); // Sunday
    const older = new Date('2026-10-22T23:00:00.000Z'); // Thursday
    expect([latest, older].sort().at(-1)).toBe(older); // documents the default-sort trap
    expect(latestObservedAt([latest, older])).toBe(latest);
    expect(latestObservedAt([null, 'not-a-date', older, latest])).toBe(latest);
    expect(latestObservedAt([null, 'not-a-date'])).toBeNull();
  });
  test('keeps journey mutation and audit event on the same tenant transaction client', async () => {
    const calls=[];
    const req={user:{id:'user-1',org_id:'org-1',role:'dispatcher'},dbTx:async fn=>fn({query:async(sql,params)=>{calls.push({sql,params});return {rows:[{id:'row-1',status:'in_progress'}]};}})};
    const journey={id:'journey-1',org_id:'org-1'};
    const result=await mutateWithEvent(req,journey,'user-1','journey_approved','Journey approved',{},'operator',
      db=>db('UPDATE sjm_journeys SET status=$1 WHERE id=$2 RETURNING id',['approved','journey-1']));
    expect(result.changed).toBe(true);
    expect(calls).toHaveLength(3);
    expect(calls[0].sql).toMatch(/FOR UPDATE/);
    expect(calls[1].sql).toMatch(/UPDATE sjm_journeys/);
    expect(calls[2].sql).toMatch(/INSERT INTO sjm_journey_events/);
  });
  test('rechecks assigned field authority under the locked journey row before mutation', async () => {
    const calls=[];
    const req={user:{id:'former-field-user',org_id:'org-1',role:'operator'},dbTx:async fn=>fn({query:async(sql,params)=>{
      calls.push({sql,params});
      if(sql.includes('FOR UPDATE'))return {rows:[{id:'journey-1',status:'in_progress'}]};
      if(sql.includes('SELECT duty_role'))return {rows:[]};
      return {rows:[{id:'should-not-write'}]};
    }})};
    const mutation=jest.fn(async db=>db("UPDATE sjm_journeys SET status='paused' WHERE id=$1 RETURNING id",['journey-1']));
    const result=await mutateWithEvent(req,{id:'journey-1',org_id:'org-1'},req.user.id,'journey_pause','Journey paused',{},'operator',mutation,async(db,locked)=>{
      expect(locked.status).toBe('in_progress');
      const roles=await db('SELECT duty_role FROM sjm_journey_participants WHERE org_id=$1 AND journey_id=$2 AND user_id=$3 AND removed_at IS NULL',['org-1','journey-1',req.user.id]);
      return canAccessJourney(req.user,roles.rows.map(row=>row.duty_role))?null:{error:'journey_not_found'};
    });
    expect(result).toMatchObject({changed:false,error:'journey_not_found'});
    expect(mutation).not.toHaveBeenCalled();
    expect(calls[0].sql).toMatch(/FOR UPDATE/);
    expect(calls[1].sql).toMatch(/SELECT duty_role/);
  });

  test('does not append an audit event when the guarded mutation changes no row', async () => {
    const calls=[];
    const req={user:{id:'user-1',org_id:'org-1',role:'dispatcher'},dbTx:async fn=>fn({query:async(sql,params)=>{calls.push(sql);if(sql.includes('FOR UPDATE'))return {rows:[{id:'journey-1',status:'in_progress'}]};return {rows:[]};}})};
    const result=await mutateWithEvent(req,{id:'journey-1',org_id:'org-1'},'user-1','journey_approved','Journey approved',{},'operator',
      db=>db('UPDATE sjm_journeys SET status=$1 WHERE id=$2 RETURNING id',['approved','journey-1']));
    expect(result.changed).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatch(/FOR UPDATE/);
    expect(calls[1]).toMatch(/UPDATE sjm_journeys/);
  });
  test('records failed Route Safety assessment as an exception without stale route or approval evidence', async () => {
    const calls=[];
    const req={user:{id:'user-1',org_id:'org-1',role:'dispatcher'},dbTx:async fn=>fn({query:async(sql,params)=>{
      calls.push({sql,params});
      return {rows:[{id:'journey-1',status:'assessment_pending'}]};
    }})};
    const result=await recordRouteAssessmentFailure(req,{id:'journey-1',org_id:'org-1'},'user-1','provider_error');
    expect(result.changed).toBe(true);
    expect(calls).toHaveLength(3);
    expect(calls[0].sql).toMatch(/FOR UPDATE/);
    expect(calls[1].sql).toMatch(/status='exception'/);
    expect(calls[1].sql).toMatch(/status='assessment_pending'/);
    expect(calls[1].sql).toContain("planned_route='[]'::jsonb");
    expect(calls[1].sql).toMatch(/route_assessment=NULL/);
    expect(calls[1].sql).toMatch(/approved_at=NULL/);
    expect(calls[2].sql).toMatch(/INSERT INTO sjm_journey_events/);
    expect(calls[2].params[3]).toBe('route_assessment_failed');
    expect(JSON.parse(calls[2].params[5])).toMatchObject({
      failure_reason:'provider_error',
      route_status:'UNAVAILABLE',
      safety_gate:'UNAVAILABLE',
      approval_allowed:false
    });
  });

  test('does not audit a route-assessment failure if another request already changed the journey state', async () => {
    const calls=[];
    const req={user:{id:'user-1',org_id:'org-1',role:'dispatcher'},dbTx:async fn=>fn({query:async(sql,params)=>{calls.push({sql,params});if(sql.includes('FOR UPDATE'))return {rows:[{id:'journey-1',status:'cancelled'}]};return {rows:[]};}})};
    const result=await recordRouteAssessmentFailure(req,{id:'journey-1',org_id:'org-1'},'user-1','invalid_provider_response');
    expect(result.changed).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toMatch(/FOR UPDATE/);
    expect(calls[1].sql).toMatch(/status='assessment_pending'/);
  });

  test('propagates audit write failures so the transaction wrapper can roll back', async () => {
    let rollbackObserved=false;
    const req={user:{id:'user-1',org_id:'org-1',role:'dispatcher'},dbTx:async fn=>{try{return await fn({query:async(sql,params)=>{
      if(sql.includes('INSERT INTO sjm_journey_events'))throw new Error('audit write failed');
      return {rows:[{id:'journey-1'}]};
    }});}catch(e){rollbackObserved=true;throw e;}}};
    await expect(mutateWithEvent(req,{id:'journey-1',org_id:'org-1'},'user-1','journey_approved','Journey approved',{},'operator',
      db=>db('UPDATE sjm_journeys SET status=$1 WHERE id=$2 RETURNING id',['approved','journey-1']))).rejects.toThrow('audit write failed');
    expect(rollbackObserved).toBe(true);
  });
  test('defines the expanded lifecycle and refuses unsafe shortcuts', () => {
    expect(lifecycleTransition('approved','ready_to_depart')?.to).toBe('ready_to_depart');
    expect(lifecycleTransition('ready_to_depart','start')?.to).toBe('in_progress');
    expect(lifecycleTransition('in_progress','pause')?.to).toBe('paused');
    expect(lifecycleTransition('in_progress','arrive')?.to).toBe('arrival_pending_verification');
    expect(lifecycleTransition('arrival_pending_verification','start')).toBeNull();
    expect(lifecycleTransition('in_progress','cancel')).toBeNull();
    expect(lifecycleTransition('in_progress','replan')).toBeNull();
    expect(lifecycleTransition('paused','replan')?.clearPlan).toBe(true);
    expect(lifecycleTransition('exception','replan')?.to).toBe('planning');
    expect(lifecycleTransition('on_hold','replan')?.to).toBe('planning');
  });
  test('accepts valid geographic coordinates and rejects out-of-range and null-island coordinates', () => {
    expect(validCoordinate(-90,180)).toBe(true); expect(validCoordinate(91,20)).toBe(false); expect(validCoordinate(-1,181)).toBe(false); expect(validCoordinate(0,0)).toBe(false); expect(validCoordinate(null,20)).toBe(false);
  });
  test('validates journey content and chronology', () => {
    expect(validateJourney(valid)).toBeNull(); expect(validateJourney({...valid,planned_arrival_at:'2026-10-27T02:00:00Z'})).toMatch(/after planned departure/); expect(validateJourney({...valid,purpose:' '})).toMatch(/purpose is required/); expect(validateJourney({...valid,timezone:'Mars/NotAZone'})).toMatch(/valid IANA timezone/);
  });
  test('accepts PostgreSQL Date values when validating an existing journey and its stops', () => {
    const departure=new Date('2026-10-28T03:00:00.000Z');
    const arrival=new Date('2026-10-28T13:00:00.000Z');
    expect(validateJourney({...valid,planned_departure_at:departure,planned_arrival_at:arrival})).toBeNull();
    expect(validateStop({name:'Existing checkpoint',stop_type:'checkpoint',lat:1,lng:2,planned_arrival_at:departure,planned_departure_at:arrival})).toBeNull();
    expect(validateJourney({...valid,planned_departure_at:new Date('invalid')})).toMatch(/times must be valid ISO dates/);
  });
  test('validates stop type, coordinate pairs and stop limit', () => {
    expect(validateStop({name:'Border',stop_type:'border',lat:1,lng:2})).toBeNull(); expect(validateStop({name:'Border',lat:1})).toMatch(/supplied together/); expect(validateStop({name:'Unlocated checkpoint'})).toMatch(/coordinates are required/); expect(validateStop({name:'Border',stop_type:'fictional'})).toMatch(/not supported/); expect(validateJourney({...valid,stops:Array.from({length:31},(_,i)=>({name:'Stop '+i}))})).toMatch(/at most 23 stops/);
  });
  test('blocks absent, unrouted, blocked and unresolved human-review evidence', () => {
    expect(approvalGate(null,null,null).code).toBe('ROUTED_EVIDENCE_REQUIRED'); expect(approvalGate({route_status:'unrouted',safety_gate:'GO'},null,null).ok).toBe(false);
    expect(approvalGate({route_status:'blocked',safety_gate:'HUMAN_REVIEW',recommended_route:{blocked:true}},'approve_with_controls','Controls are recorded for this movement.').code).toBe('ROUTE_BLOCKED');
    expect(approvalGate({route_status:'routed',safety_gate:'HUMAN_REVIEW'},null,'Controls are recorded for this movement.').code).toBe('HUMAN_REVIEW_REQUIRED');
  });
  test('requires written controls for conditional routes; dates use the configured timezone', () => {
    const a={route_status:'routed',safety_gate:'CONDITIONAL',recommended_route:{blocked:false}};
    expect(approvalGate(a,null,'').code).toBe('RISK_ACKNOWLEDGEMENT_REQUIRED'); expect(approvalGate(a,null,'Controls: daylight only, scheduled check-ins and approved rest points.').ok).toBe(true);
    expect(approvalGate({route_status:'routed',safety_gate:'GO'},null,null).ok).toBe(true);
    expect(dateInTimezone(new Date('2026-10-27T22:30:00Z'),'Africa/Nairobi')).toBe('2026-10-28');
  });

  test('supports distinct report types and a separate portfolio summary', () => {
    expect(REPORT_TYPES).toEqual(['itinerary','pre_trip_brief','daily','sitrep','change_notice','closeout','final']);
    expect(REPORT_TITLES.sitrep).toMatch(/Situation Report/);
    expect(REPORT_TITLES.management_summary).toMatch(/Portfolio Summary/);
  });
  test('rejects impossible calendar dates', () => {
    expect(validDateOnly('2026-10-27')).toBe(true);
    expect(validDateOnly('2026-02-31')).toBe(false);
    expect(validDateOnly('27-10-2026')).toBe(false);
  });
  test('never classifies a future-dated device fix as LIVE', () => {
    const now=Date.parse('2026-10-27T15:00:00Z');
    expect(freshnessFor('2026-10-27T14:59:59Z',now)).toBe('LIVE');
    expect(freshnessFor('2026-10-27T14:50:00Z',now)).toBe('STALE');
    expect(freshnessFor('2026-10-27T15:01:00Z',now)).toBe('UNAVAILABLE');
    expect(freshnessFor(null,now)).toBe('UNAVAILABLE');
  });
  test('returns latest convoy-linked device fixes as observed evidence for the mission detail payload', async () => {
    const observedAt = new Date(Date.now() - 12_000);
    const calls = [];
    const db = async (sql, params) => {
      calls.push({sql,params});
      return {rows:[{
        device_id:'device-1',device_name:'Truck locator',officer_name:'Assigned officer',
        lat:-1.2864,lng:36.8172,speed_kph:37,heading:84,accuracy_m:9,
        observed_at:observedAt,source:'device_locations'
      }]};
    };
    const result = await telemetryFor(db,'org-1',{convoy_id:'convoy-1'});
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/FROM convoy_cfos/);
    expect(calls[0].params).toEqual(['org-1','convoy-1']);
    expect(result.status).toBe('LIVE');
    expect(result.observed_at).toEqual(observedAt);
    expect(result.devices[0]).toMatchObject({
      device_id:'device-1',lat:-1.2864,lng:36.8172,
      freshness:'LIVE',evidence_class:'OBSERVED',source:'device_locations'
    });
    expect(result.devices[0].freshness_reason).toBeNull();
  });
  test('does not label a fresh timestamp as a live fix when its coordinates are unusable', async () => {
    const observedAt = new Date(Date.now() - 12_000);
    const db = async () => ({rows:[{
      device_id:'device-no-fix',device_name:'Locator without coordinates',
      lat:null,lng:36.8,speed_kph:null,heading:null,accuracy_m:null,
      observed_at:observedAt,source:'device_locations'
    }]});
    const result = await telemetryFor(db,'org-1',{convoy_id:'convoy-1'});
    expect(result.status).toBe('UNAVAILABLE');
    expect(result.devices[0]).toMatchObject({
      freshness:'UNAVAILABLE',
      position_available:false,
      freshness_reason:'latest_record_has_no_usable_coordinates',
      evidence_class:'OBSERVED'
    });
    expect(result.devices[0].age_seconds).toBeGreaterThanOrEqual(0);
  });

  test('does not query or invent device evidence when no convoy is linked', async () => {
    const db = jest.fn();
    const result = await telemetryFor(db,'org-1',{convoy_id:null});
    expect(db).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status:'UNAVAILABLE',
      reason:'No convoy linked to this journey; live fleet evidence is unavailable.',
      observed_at:null,
      devices:[]
    });
  });
  test('reports unknown pre-trip evidence as pending/unavailable rather than verified', () => {
    const checklist=readinessChecklist({status:'requested',approved_at:null,convoy_id:null,departure_readiness_acknowledgement:null},[],null,{status:'UNAVAILABLE',reason:'No convoy linked.'});
    expect(checklist.find(x=>x.item==='Stored Route Safety assessment').status).toBe('UNAVAILABLE');
    expect(checklist.find(x=>x.item==='Human route review').status).toBe('UNAVAILABLE');
    expect(checklist.find(x=>x.item==='Journey approval').status).toBe('PENDING');
    expect(checklist.find(x=>x.item==='Convoy linkage').status).toBe('NOT_LINKED');
    expect(checklist.find(x=>x.item==='Convoy device telemetry').status).toBe('UNAVAILABLE');
  });

  test('accepts explicit unrouted fallback as a usable exception assessment without inventing risk or distance', () => {
    const explicitUnrouted={
      route_status:'unrouted',
      safety_gate:'HUMAN_REVIEW',
      overall_risk_score:null,
      constraint_status:{risk_score_available:false,max_risk_exceeded:true},
      recommended_route:{
        label:'Unrouted waypoint reference',
        waypoints:[{lat:-1.28,lng:36.81},{lat:-4.04,lng:39.66}],
        risk_score:null,distance_km:null,estimated_duration_minutes:null,
        notes:'Road routing unavailable. Risk score unavailable.'
      }
    };
    expect(routeAssessmentUsable(explicitUnrouted)).toBe(true);
    expect(routeAssessmentUsable({...explicitUnrouted,constraint_status:{risk_score_available:true}})).toBe(false);
    expect(routeAssessmentUsable({...explicitUnrouted,safety_gate:'GO'})).toBe(false);
    expect(routeAssessmentUsable({...explicitUnrouted,overall_risk_score:12})).toBe(false);
    expect(routeAssessmentUsable({route_status:'routed',safety_gate:'GO',overall_risk_score:12})).toBe(true);
    expect(routeAssessmentUsable({route_status:'routed',safety_gate:'GO',overall_risk_score:null})).toBe(false);
  });

  test('only declares human review unnecessary after a routed GO/CONDITIONAL gate exists', () => {
    const base={status:'requested',approved_at:null,convoy_id:'convoy-1',departure_readiness_acknowledgement:null};
    const telemetry={status:'UNAVAILABLE',reason:'No location record.'};
    const status=(assessment,decision=null)=>readinessChecklist({...base,human_review_decision:decision},[],assessment,telemetry).find(x=>x.item==='Human route review').status;
    expect(status(null)).toBe('UNAVAILABLE');
    expect(status({route_status:'routed',safety_gate:'GO'})).toBe('NOT_REQUIRED_BY_CURRENT_GATE');
    expect(status({route_status:'routed',safety_gate:'CONDITIONAL'})).toBe('NOT_REQUIRED_BY_CURRENT_GATE');
    expect(status({route_status:'routed',safety_gate:'HUMAN_REVIEW'})).toBe('PENDING');
    expect(status({route_status:'routed',safety_gate:'HUMAN_REVIEW'},'approve_with_controls')).toBe('RECORDED_WITH_CONTROLS');
    expect(status({route_status:'routed',safety_gate:'HUMAN_REVIEW'},'reject')).toBe('REJECTED');
    expect(status({route_status:'blocked',safety_gate:'NO_GO'})).toBe('BLOCKED');
  });
  test('selects only recorded route, approval, lifecycle and stop events for change notices', () => {
    const selected=changeEventsFor([{event_type:'operator_note'},{event_type:'route_assessed'},{event_type:'journey_pause'},{event_type:'stop_reached'}]);
    expect(selected.map(x=>x.event_type)).toEqual(['route_assessed','journey_pause','stop_reached']);
  });
  test('CSV exports defend against spreadsheet formula injection', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('-12.5')).toBe('-12.5');
  });
  test('summarises tenant aggregates without overstating telemetry coverage', () => {
    const summary=managementSummaryCounts([{telemetry_status:'LIVE'},{telemetry_status:'STALE'},{telemetry_status:'UNAVAILABLE'}],
      {total_journeys:12,open_journeys:9,active_controlled_journeys:4,planning_queue:2,approval_queue:1,paused_exception_or_hold:3,arrival_pending_verification:1,overdue_journeys:2,route_review_required:1},
      {requested:2,in_progress:4,closed:3},905,250);
    expect(summary.total_journeys).toBe(12);
    expect(summary.open_journeys).toBe(9);
    expect(summary.status_counts.closed).toBe(3);
    expect(summary.telemetry_status_counts).toEqual({LIVE:1,DELAYED:0,STALE:1,UNAVAILABLE:1});
    expect(summary.telemetry_journey_sample_count).toBe(3);
    expect(summary.recent_events_last_24h).toBe(905);
    expect(summary.recent_events_included).toBe(250);
    expect(summary.recent_events_truncated).toBe(true);
  });


  test('management event totals remain exact when the displayed event list is capped', () => {
    const summary=managementSummaryCounts([], {total_journeys:0}, {}, 905, 250);
    expect(summary.recent_events_last_24h).toBe(905);
    expect(summary.recent_events_included).toBe(250);
    expect(summary.recent_events_truncated).toBe(true);
  });


  test('rejects caller-supplied SJM risk thresholds that could weaken the Route Safety gate', () => {
    expect(planRequestPolicyError({max_risk_score:100})).toMatch(/caller-supplied maximum risk threshold/);
    expect(planRequestPolicyError({max_risk_score:0})).toMatch(/authorised trusted client policy/);
    expect(planRequestPolicyError({avoid_night_travel:true})).toBeNull();
    expect(planRequestPolicyError({})).toBeNull();
  });
  test('PDF focus sections obey client section policy while retaining intrinsic report evidence', () => {
    const report={client_profile:{enabled_sections:['summary']},summary:{safety_gate:'GO'},route_assessment:{route_status:'routed'},itinerary:[{name:'Restricted route point'}],stops:[{name:'Restricted stop'}]};
    const itineraryFocus=JSON.stringify(reportFocusSections({...report,report_type:'itinerary'}));
    expect(itineraryFocus).not.toContain('Route status');
    expect(itineraryFocus).not.toContain('Stored route points');
    expect(itineraryFocus).not.toContain('Restricted route point');
    expect(itineraryFocus).not.toContain('Ordered stops');
    const daily={...report,report_type:'daily',generated_at:'2026-10-27T15:00:00Z',summary:{safety_gate:'GO',telemetry_status:'LIVE',stop_count:1,reached_stops:0,pending_stops:1,event_count:1}};
    const dailyFocus=JSON.stringify(reportFocusSections(daily));
    expect(dailyFocus).toContain('Lifecycle status');
    expect(dailyFocus).not.toContain('Route Safety gate');
    expect(dailyFocus).not.toContain('LIVE');
    expect(dailyFocus).not.toContain('Outstanding planned stops');
    const sitrepFocus=JSON.stringify(reportFocusSections({...daily,report_type:'sitrep'}));
    expect(sitrepFocus).toContain('Current lifecycle state');
    expect(sitrepFocus).not.toContain('Route status / safety gate');
    expect(sitrepFocus).not.toContain('Telemetry state');
    expect(sitrepFocus).not.toContain('Most recent recorded event');
    const fullProfile={...daily,client_profile:{enabled_sections:['summary','itinerary','stops','route_assessment','operational_events','telemetry_snapshot']},events:[{event_type:'incident',summary:'Latest evidence',created_at:'2026-10-27T14:00:00Z',source:'operator'}],route_assessment:{route_status:'routed'},telemetry_snapshot:{status:'LIVE',observed_at:'2026-10-27T14:59:00Z'}};
    expect(JSON.stringify(reportFocusSections(fullProfile))).toContain('Route Safety gate');
    expect(JSON.stringify(reportFocusSections({...fullProfile,report_type:'sitrep'}))).toContain('Latest evidence');
    const readiness=reportFocusSections({report_type:'pre_trip_brief',client_profile:{enabled_sections:[]},pre_trip_readiness:[{item:'Route assessment',status:'PENDING',detail:'No assessment recorded'}]});
    expect(readiness[0].body).toContain('Route assessment');
    expect(enabledReportSections({enabled_sections:['summary','unknown','summary']})).toEqual(['summary']);
    expect(enabledReportSections({enabled_sections:[]})).toEqual([]);
  });
  test('report CSV respects client section policy for optional stop, event and telemetry evidence', () => {
    const csv=toCsv({
      report_type:'daily',report_title:'Daily Travel Report',report_date:'2026-10-27',generated_at:'2026-10-27T15:00:00Z',
      client_profile:{enabled_sections:['summary']},
      journey:{id:'j1',reference:'SJM-1',title:'Restricted movement',purpose:'client private purpose',status:'in_progress',origin_label:'Private origin',destination_label:'Private destination'},
      itinerary:[{name:'Hidden route point',lat:-1.2,lng:36.8}],
      stops:[{id:'s1',name:'Private checkpoint',stop_status:'planned',instructions:'Secret checkpoint notes'}],
      events:[{id:'e1',event_type:'incident',summary:'Sensitive event summary',source:'operator',detail:{note:'Private notes'}}],
      route_assessment:{route_status:'routed',safety_gate:'GO',ai_summary:'Private safety narrative'},
      telemetry_snapshot:{status:'LIVE',devices:[{device_name:'Private device',freshness:'LIVE',lat:-1.2,lng:36.8}]},
      summary:{stop_count:1,event_count:1,safety_gate:'GO',telemetry_status:'LIVE'}
    });
    expect(csv).toContain('client private purpose');
    expect(csv).not.toContain('Private checkpoint');
    expect(csv).not.toContain('Sensitive event summary');
    expect(csv).not.toContain('Private safety narrative');
    expect(csv).not.toContain('Private device');
    expect(csv).not.toContain('Hidden route point');
  });
  test('client reports exclude internal field-event records', async () => {
    const calls=[];const db=async(sql,params)=>{calls.push({sql,params});return {rows:[]};};
    expect((await eventsForReport(db,'org-1','journey-1',500)).rows).toHaveLength(0);
    expect(calls[0].sql).toContain("detail->>'classification'='CLIENT_SAFE'");
  });
  test('report event query returns exact totals and flags truncated history separately from included rows', async () => {
    const sqlCalls=[];
    const db=async(sql,params)=>{sqlCalls.push({sql,params});return {rows:[{id:'e1',event_type:'journey_pause',summary:'paused',total_count:501,total_change_count:400}]};};
    const result=await eventsForReport(db,'org-1','journey-1',500);
    expect(result.total).toBe(501);
    expect(result.totalChanges).toBe(400);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].total_count).toBeUndefined();
    expect(sqlCalls[0].sql).toMatch(/COUNT\(\*\) OVER\(\)/);
  });

  test('escapes CSV values', () => {
    const csv=toCsv({journey:{reference:'SJM-1',title:'A, B',status:'planned'},stops:[],events:[],telemetry_snapshot:{devices:[]}});
    expect(csv).toContain('"A, B"'); expect(csv).toContain('record_type,timestamp,label,status,details');
    expect(csvCell('=1+1')).toBe("'=1+1");
  });
});
