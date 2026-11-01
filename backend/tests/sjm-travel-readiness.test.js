'use strict';

const {
  activityHasStaffing, calendarDates, findProgrammeScheduleConflicts, evaluateTravelReadiness,
} = require('../src/services/sjmTravelReadiness');

const journey = overrides => ({
  id: '10000000-0000-4000-8000-000000000001',
  org_id: '20000000-0000-4000-8000-000000000001',
  service_type: 'executive_transfer',
  timezone: 'Africa/Nairobi',
  planned_departure_at: '2026-11-01T08:00:00.000Z',
  planned_arrival_at: '2026-11-03T15:00:00.000Z',
  ...overrides,
});
const principal = { id: '30000000-0000-4000-8000-000000000001', traveller_type: 'principal' };

describe('SJM server-side travel readiness', () => {
  test('requires exactly one principal traveller at approval', () => {
    const missing = evaluateTravelReadiness({ journey: journey({}), travellers: [], flights: [], days: [], documents: [] }, 'approval');
    expect(missing.ready).toBe(false);
    expect(missing.blockers.map(item => item.code)).toContain('principal_traveller_missing');

    const valid = evaluateTravelReadiness({ journey: journey({}), travellers: [principal], flights: [], days: [], documents: [] }, 'approval');
    expect(valid.ready).toBe(true);

    const ambiguous = evaluateTravelReadiness({ journey: journey({}), travellers: [principal, { id: 'x', traveller_type: 'principal' }], flights: [], days: [], documents: [] }, 'approval');
    expect(ambiguous.blockers.map(item => item.code)).toContain('principal_traveller_ambiguous');
  });

  test('requires a non-cancelled flight for every airport traveller or one shared flight', () => {
    const airportJourney = journey({ service_type: 'airport_arrival' });
    const accompanying = { id: '30000000-0000-4000-8000-000000000002', traveller_type: 'accompanying' };
    const noFlight = evaluateTravelReadiness({ journey: airportJourney, travellers: [principal, accompanying], flights: [], days: [], documents: [] }, 'approval');
    expect(noFlight.blockers.map(item => item.code)).toContain('airport_flight_details_incomplete');

    const partial = evaluateTravelReadiness({
      journey: airportJourney, travellers: [principal, accompanying],
      flights: [{ id: 'flight-1', traveller_id: principal.id, status: 'scheduled' }], days: [], documents: [],
    }, 'approval');
    expect(partial.blockers.map(item => item.code)).toContain('airport_flight_details_incomplete');

    const shared = evaluateTravelReadiness({
      journey: airportJourney, travellers: [principal, accompanying],
      flights: [{ id: 'flight-1', traveller_id: null, status: 'scheduled' }], days: [], documents: [],
    }, 'approval');
    expect(shared.ready).toBe(true);

    const cancelled = evaluateTravelReadiness({
      journey: airportJourney, travellers: [principal],
      flights: [{ id: 'flight-1', traveller_id: principal.id, status: 'cancelled' }], days: [], documents: [],
    }, 'approval');
    expect(cancelled.blockers.map(item => item.code)).toContain('airport_flight_details_incomplete');

    const diverted = evaluateTravelReadiness({
      journey: airportJourney, travellers: [principal],
      flights: [{ id: 'flight-1', traveller_id: principal.id, status: 'diverted' }], days: [], documents: [],
    }, 'approval');
    expect(diverted.blockers.map(item => item.code)).toContain('airport_flight_details_incomplete');
  });

  test('treats meet-and-greet as an airport service and rejects diverted flight legs', () => {
    const airportJourney = journey({ service_type: 'meet_and_greet' });
    const missing = evaluateTravelReadiness({
      journey: airportJourney, travellers: [principal], flights: [], days: [], documents: [],
    }, 'approval');
    expect(missing.blockers.map(item => item.code)).toContain('airport_flight_details_incomplete');

    const diverted = evaluateTravelReadiness({
      journey: airportJourney, travellers: [principal],
      flights: [{ id: 'flight-diverted', traveller_id: principal.id, status: 'diverted' }],
      days: [], documents: [],
    }, 'approval');
    expect(diverted.blockers.map(item => item.code)).toContain('airport_flight_details_incomplete');
  });

  test('requires duty-role assignments to be backed by an active journey participant', () => {
    expect(activityHasStaffing({ responsible_user_assigned: true, responsible_role_staffed: false })).toBe(true);
    expect(activityHasStaffing({ responsible_user_assigned: false, responsible_role_staffed: true })).toBe(true);
    expect(activityHasStaffing({ responsible_user_assigned: false, responsible_role_staffed: false })).toBe(false);
    expect(activityHasStaffing({})).toBe(false);
  });

  test('requires every daily activity to have a named operator or accountable role before departure', () => {
    const base = { journey: journey({}), travellers: [principal], flights: [], documents: [] };
    const days = [
      { journey_date: '2026-11-01', activity_count: 2, unassigned_activity_count: 0 },
      { journey_date: '2026-11-02', activity_count: 1, unassigned_activity_count: 1 },
      { journey_date: '2026-11-03', activity_count: 1, unassigned_activity_count: 0 },
    ];
    const incomplete = evaluateTravelReadiness({ ...base, days }, 'departure');
    expect(incomplete.blockers.map(item => item.code)).toContain('daily_programme_unassigned');
    const assigned = evaluateTravelReadiness({
      ...base, days: days.map(day => ({ ...day, unassigned_activity_count: 0 })),
    }, 'departure');
    expect(assigned.ready).toBe(true);
  });

  test('requires every local travel date to have a timed programme activity before departure', () => {
    expect(calendarDates('2026-11-01', '2026-11-03')).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    const base = { journey: journey({}), travellers: [principal], flights: [], documents: [] };
    const incomplete = evaluateTravelReadiness({ ...base, days: [
      { journey_date: '2026-11-01', activity_count: 2 },
      { journey_date: '2026-11-03', activity_count: 1 },
    ] }, 'departure');
    expect(incomplete.ready).toBe(false);
    expect(incomplete.blockers.find(item => item.code === 'daily_programme_incomplete')?.missing_dates).toEqual(['2026-11-02']);

    const complete = evaluateTravelReadiness({ ...base, days: [
      { journey_date: '2026-11-01', activity_count: 2 },
      { journey_date: '2026-11-02', activity_count: 1 },
      { journey_date: '2026-11-03', activity_count: 1 },
    ] }, 'departure');
    expect(complete.ready).toBe(true);
    expect(complete.counts.required_programme_day_count).toBe(3);
  });

  test('requires every timed programme activity to have named staff or an accountable duty role', () => {
    const readiness = evaluateTravelReadiness({
      journey: journey({}),
      travellers: [principal],
      flights: [],
      days: [
        { journey_date: '2026-11-01', activity_count: 2, unassigned_activity_count: 1 },
        { journey_date: '2026-11-02', activity_count: 1, unassigned_activity_count: 0 },
        { journey_date: '2026-11-03', activity_count: 1, unassigned_activity_count: 0 },
      ],
      documents: [],
    }, 'departure');
    expect(readiness.ready).toBe(false);
    expect(readiness.counts.unassigned_activity_count).toBe(1);
    expect(readiness.blockers.map(item => item.code)).toContain('daily_programme_unassigned');
  });

  test('blocks uploaded unverified, rejected or expired documents without inventing mandatory document types', () => {
    const base = {
      journey: journey({}), travellers: [principal], flights: [],
      days: [
        { journey_date: '2026-11-01', activity_count: 1 },
        { journey_date: '2026-11-02', activity_count: 1 },
        { journey_date: '2026-11-03', activity_count: 1 },
      ],
    };
    const pending = evaluateTravelReadiness({ ...base, documents: [
      { document_type: 'passport', review_status: 'PENDING_REVIEW', evidence_status: 'VERIFIED', expiry_date: '2030-01-01' },
    ] }, 'departure');
    expect(pending.blockers.map(item => item.code)).toContain('travel_documents_not_cleared');

    const expired = evaluateTravelReadiness({ ...base, documents: [
      { document_type: 'visa', review_status: 'VERIFIED', evidence_status: 'VERIFIED', expiry_date: '2026-11-02' },
    ] }, 'departure');
    expect(expired.blockers.map(item => item.code)).toContain('travel_documents_not_cleared');

    const noDocumentPolicyGuess = evaluateTravelReadiness({ ...base, documents: [] }, 'departure');
    expect(noDocumentPolicyGuess.ready).toBe(true);
    expect(noDocumentPolicyGuess.warnings.map(item => item.code)).toContain('no_travel_documents_recorded');
  });

  test('blocks invalid or excessive schedule ranges instead of silently skipping programme dates', () => {
    const invalid = evaluateTravelReadiness({
      journey: journey({ planned_arrival_at: '2026-10-30T12:00:00.000Z' }),
      travellers: [principal], flights: [], days: [], documents: [],
    }, 'departure');
    expect(invalid.blockers.map(item => item.code)).toContain('journey_schedule_missing');

    const excessive = evaluateTravelReadiness({
      journey: journey({ planned_departure_at: '2026-01-01T00:00:00.000Z', planned_arrival_at: '2027-01-02T00:00:00.000Z' }),
      travellers: [principal], flights: [], days: [], documents: [],
    }, 'departure');
    expect(excessive.blockers.map(item => item.code)).toContain('journey_schedule_range_invalid');
  });
  test('detects strict traveller overlaps without adding an arbitrary buffer', () => {
    const activity = (id, start, end) => ({ id, planned_start_at: start, planned_end_at: end, traveller_id: principal.id, responsible_user_id: null, execution_status: 'planned' });
    expect(findProgrammeScheduleConflicts([
      activity('activity-a', '2026-11-01T09:00:00.000Z', '2026-11-01T10:00:00.000Z'),
      activity('activity-b', '2026-11-01T09:59:59.000Z', '2026-11-01T11:00:00.000Z'),
      activity('activity-adjacent', '2026-11-01T10:00:00.000Z', '2026-11-01T10:30:00.000Z'),
    ])).toBe(1);
  });

  test('detects same named operator commitments but does not infer identity from a duty role', () => {
    const activity = (id, travellerId, userId) => ({
      id, planned_start_at: '2026-11-01T09:00:00Z', planned_end_at: '2026-11-01T10:00:00Z',
      traveller_id: travellerId, responsible_user_id: userId, responsible_role: 'detail_leader', execution_status: 'planned',
    });
    expect(findProgrammeScheduleConflicts([
      activity('activity-a', principal.id, 'user-1'),
      activity('activity-b', 'traveller-2', 'user-1'),
      activity('activity-c', 'traveller-3', 'user-2'),
    ])).toBe(1);
  });

  test('treats null traveller assignment as shared-party and ignores completed or skipped activities', () => {
    const activity = (id, travellerId, status = 'planned') => ({
      id, planned_start_at: '2026-11-01T09:00:00Z', planned_end_at: '2026-11-01T10:00:00Z',
      traveller_id: travellerId, responsible_user_id: null, execution_status: status,
    });
    expect(findProgrammeScheduleConflicts([
      activity('shared-party', null), activity('principal-transfer', principal.id),
      activity('already-completed', principal.id, 'completed'), activity('skipped-item', principal.id, 'skipped'),
    ])).toBe(1);
  });

  test('normalises timezone offsets and ignores invalid or non-positive intervals', () => {
    const activity = (id, start, end) => ({ id, planned_start_at: start, planned_end_at: end, traveller_id: principal.id, responsible_user_id: null, execution_status: 'planned' });
    expect(findProgrammeScheduleConflicts([
      activity('offset-a', '2026-11-01T12:00:00+03:00', '2026-11-01T13:00:00+03:00'),
      activity('offset-b', '2026-11-01T09:30:00Z', '2026-11-01T10:30:00Z'),
      activity('invalid', 'not-a-date', '2026-11-01T11:00:00Z'),
      activity('zero-length', '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z'),
    ])).toBe(1);
  });

  test('blocks route approval on overlapping activities and exposes only an aggregate conflict count', () => {
    const readiness = evaluateTravelReadiness({
      journey: journey({}), travellers: [principal], flights: [], days: [], documents: [],
      activities: [
        { id: 'private-item-1', planned_start_at: '2026-11-01T09:00:00Z', planned_end_at: '2026-11-01T10:00:00Z', traveller_id: principal.id, responsible_user_id: null, execution_status: 'planned' },
        { id: 'private-item-2', planned_start_at: '2026-11-01T09:30:00Z', planned_end_at: '2026-11-01T10:30:00Z', traveller_id: principal.id, responsible_user_id: null, execution_status: 'planned' },
      ],
    }, 'approval');
    expect(readiness.ready).toBe(false);
    expect(readiness.counts.schedule_conflict_count).toBe(1);
    const blocker = readiness.blockers.find(item => item.code === 'programme_schedule_conflict');
    expect(blocker.conflict_count).toBe(1);
    expect(blocker.message).toMatch(/overlapping planned activities/);
    expect(JSON.stringify(blocker)).not.toContain('private-item');
    expect(JSON.stringify(blocker)).not.toContain(principal.id);
  });

  test('returns a zero conflict count when a programme has no overlapping commitments', () => {
    const readiness = evaluateTravelReadiness({
      journey: journey({}), travellers: [principal], flights: [], days: [], documents: [],
      activities: [{
        id: 'activity-a', planned_start_at: '2026-11-01T09:00:00Z',
        planned_end_at: '2026-11-01T10:00:00Z', traveller_id: principal.id,
        responsible_user_id: null, execution_status: 'planned',
      }],
    }, 'approval');
    expect(readiness.counts.schedule_conflict_count).toBe(0);
    expect(readiness.blockers.map(item => item.code)).not.toContain('programme_schedule_conflict');
  });

  test('counts one overlapping pair once when both traveller and named operator match', () => {
    const activity = id => ({
      id, planned_start_at: '2026-11-01T09:00:00Z', planned_end_at: '2026-11-01T10:00:00Z',
      traveller_id: principal.id, responsible_user_id: 'same-operator', execution_status: 'planned',
    });
    expect(findProgrammeScheduleConflicts([activity('first'), activity('second')])).toBe(1);
  });

  test('counts large overlap sets without retaining one object per conflicting pair', () => {
    const size = 1800;
    const activities = Array.from({ length: size }, (_, index) => ({
      id: 'activity-' + index,
      planned_start_at: '2026-11-01T09:00:00Z',
      planned_end_at: '2026-11-01T10:00:00Z',
      traveller_id: principal.id,
      responsible_user_id: null,
      execution_status: 'planned',
    }));
    expect(findProgrammeScheduleConflicts(activities)).toBe(size * (size - 1) / 2);
  });

});
