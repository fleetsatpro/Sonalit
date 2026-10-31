'use strict';

const {
  activityHasStaffing, calendarDates, evaluateTravelReadiness,
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
});
