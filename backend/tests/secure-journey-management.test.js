'use strict';
const sjmRouter = require('../src/routes/secureJourneyManagement');
const { authenticate } = require('../src/middleware/auth');
const { validCoordinate, validateStop, validateJourney, approvalGate, dateInTimezone, toCsv, lifecycleTransition, dailyReportSchedulerAvailable } = sjmRouter.__test;
const { configuredOrgIds, shouldGenerateForToday } = require('../src/services/sjmDailyReportScheduler');
describe('SJM validation and evidence boundaries', () => {
  test('authenticates requests before the tenant-scope guard', () => {
    const authIndex = sjmRouter.stack.findIndex(layer => layer.handle === authenticate);
    expect(authIndex).toBeGreaterThanOrEqual(0);
    const firstRouteIndex = sjmRouter.stack.findIndex(layer => Boolean(layer.route));
    expect(firstRouteIndex).toBeGreaterThan(authIndex);
  });
  const valid = { title:'Nairobi to Mombasa security movement', purpose:'Client-approved escorted road movement', origin_label:'Nairobi', origin_lat:-1.286389, origin_lng:36.817223, destination_label:'Mombasa', destination_lat:-4.043477, destination_lng:39.668206, planned_departure_at:'2026-10-28T06:00:00+03:00', planned_arrival_at:'2026-10-28T16:00:00+03:00', transport_mode:'road', stops:[{name:'Voi checkpoint',stop_type:'checkpoint',lat:-3.396,lng:38.556}] };
  test('keeps daily report generation tenant-allowlisted and respects client-local time', () => {
    const org='12345678-1234-4234-8234-123456789abc';
    expect(configuredOrgIds('')).toEqual([]);
    expect(configuredOrgIds(' '+org.toUpperCase()+', '+org+' ')).toEqual([org]);
    expect(()=>configuredOrgIds('not-a-uuid')).toThrow(/invalid UUID/);
    expect(dailyReportSchedulerAvailable(org)).toBe(configuredOrgIds().includes(org));
    expect(shouldGenerateForToday(new Date('2026-10-27T14:59:00Z'),'18:00','Africa/Nairobi')).toBe(false);
    expect(shouldGenerateForToday(new Date('2026-10-27T15:00:00Z'),'18:00','Africa/Nairobi')).toBe(true);
    expect(shouldGenerateForToday(new Date('2026-10-27T15:00:00Z'),'18:00','Mars/Nowhere')).toBe(false);
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
  test('escapes CSV values', () => {
    const csv=toCsv({journey:{reference:'SJM-1',title:'A, B',status:'planned'},stops:[],events:[],telemetry_snapshot:{devices:[]}});
    expect(csv).toContain('"A, B"'); expect(csv).toContain('record_type,timestamp,label,status,details');
  });
});
