'use strict';

const {
  travellerInput, flightInput, itemInput, dateOnly, validTimestamp, validTimezone, localDate, DOCUMENT_TYPES, ITEM_TYPES, flightStatusTransitionAllowed, flightStatusOptions, canExecuteItem, travelPlanMutationError, executionAllowedForJourney,
} = require('../src/routes/sjmTravelWorkspace').__test;

describe('SJM traveller and travel programme contracts', () => {
  test('validates distinct traveller identity and contact records', () => {
    const result = travellerInput({
      traveller_reference: 'TRV-001',
      traveller_type: 'principal',
      given_name: 'Amina',
      middle_name: 'Njeri',
      family_name: 'Example',
      nationality: 'Kenyan',
      date_of_birth: '1994-04-18',
      email: 'amina@example.invalid',
      phone: '+254700000000',
      emergency_contact_name: 'Emergency Contact',
      emergency_contact_phone: '+254711111111',
    });
    expect(result.error).toBeUndefined();
    expect(result.value).toMatchObject({
      traveller_reference: 'TRV-001',
      traveller_type: 'principal',
      given_name: 'Amina',
      family_name: 'Example',
      email: 'amina@example.invalid',
      phone: '+254700000000',
    });
  });

  test('rejects missing identity fields, malformed references, contact data and future dates of birth', () => {
    expect(travellerInput({ traveller_reference: 'TRV-001', family_name: 'Example' }).error).toBe('traveller_name_required');
    expect(travellerInput({ traveller_reference: 'T', given_name: 'Amina', family_name: 'Example' }).error).toBe('invalid_traveller_reference');
    expect(travellerInput({ traveller_reference: 'TRV-001', given_name: 'Amina', family_name: 'Example', email: 'not-an-email' }).error).toBe('invalid_traveller_email');
    expect(travellerInput({ traveller_reference: 'TRV-001', given_name: 'Amina', family_name: 'Example', date_of_birth: '2099-01-01' }).error).toBe('invalid_date_of_birth');
  });

  test('validates a multi-leg flight record with airport-local timezone semantics', () => {
    const flight = flightInput({
      carrier: 'Kenya Airways',
      flight_number: 'KQ 100',
      departure_airport: 'nbo',
      departure_at: '2026-11-01T06:00:00.000Z',
      departure_timezone: 'Africa/Nairobi',
      arrival_airport: 'cdg',
      arrival_at: '2026-11-01T14:00:00.000Z',
      arrival_timezone: 'Europe/Paris',
      booking_reference: 'ABC123',
    });
    expect(flight.error).toBeUndefined();
    expect(flight.value).toMatchObject({
      carrier: 'Kenya Airways',
      flight_number: 'KQ 100',
      departure_airport: 'NBO',
      arrival_airport: 'CDG',
      departure_timezone: 'Africa/Nairobi',
      arrival_timezone: 'Europe/Paris',
      booking_reference: 'ABC123',
    });
  });

  test('rejects malformed traveller links, airport identifiers and invalid flight time zones', () => {
    const base = {
      carrier: 'Carrier', flight_number: 'AB123', departure_airport: 'NBO',
      departure_at: '2026-11-01T06:00:00.000Z', departure_timezone: 'Africa/Nairobi',
      arrival_airport: 'CDG', arrival_at: '2026-11-01T14:00:00.000Z',
      arrival_timezone: 'Europe/Paris',
    };
    expect(flightInput({ ...base, traveller_id: 'not-a-uuid' }).error).toBe('traveller_not_found');
    expect(flightInput({ ...base, departure_airport: 'Nairobi' }).error).toBe('invalid_flight_airport_code');
    expect(flightInput({ ...base, arrival_at: base.departure_at }).error).toBe('invalid_flight_time_window');
    expect(flightInput({ ...base, arrival_timezone: 'Mars/Olympus' }).error).toBe('invalid_flight_timezone');
  });

  test('allows forward flight status observations and blocks terminal regressions', () => {
    expect(flightStatusTransitionAllowed('scheduled', 'boarding')).toBe(true);
    expect(flightStatusTransitionAllowed('boarding', 'departed')).toBe(true);
    expect(flightStatusTransitionAllowed('departed', 'landed')).toBe(true);
    expect(flightStatusTransitionAllowed('delayed', 'departed')).toBe(true);
    expect(flightStatusTransitionAllowed('landed', 'landed')).toBe(true);
    expect(flightStatusTransitionAllowed('landed', 'scheduled')).toBe(false);
    expect(flightStatusTransitionAllowed('cancelled', 'boarding')).toBe(false);
    expect(flightStatusTransitionAllowed('diverted', 'landed')).toBe(false);
    expect(flightStatusOptions('landed')).toEqual(['landed']);
    expect(flightStatusOptions('scheduled')).toContain('boarding');
    expect(flightStatusOptions('scheduled')).not.toContain('landed');
  });

  test('freezes the approved travel dossier until an authorised replan', () => {
    expect(travelPlanMutationError('requested')).toBeNull();
    expect(travelPlanMutationError('planning')).toBeNull();
    expect(travelPlanMutationError('assessment_pending')).toBeNull();
    expect(travelPlanMutationError('ready_for_review')).toBeNull();
    expect(travelPlanMutationError('approved').error).toBe('travel_plan_locked');
    expect(travelPlanMutationError('ready_to_depart').error).toBe('travel_plan_locked');
    expect(travelPlanMutationError('in_progress').error).toBe('travel_plan_locked');
    expect(travelPlanMutationError('on_hold').error).toBe('travel_plan_locked');
    expect(travelPlanMutationError('closed').error).toBe('journey_terminal');
  });

  test('accepts activity execution only after journey approval and release', () => {
    expect(executionAllowedForJourney('requested')).toBe(false);
    expect(executionAllowedForJourney('ready_for_review')).toBe(false);
    expect(executionAllowedForJourney('approved')).toBe(true);
    expect(executionAllowedForJourney('ready_to_depart')).toBe(true);
    expect(executionAllowedForJourney('in_progress')).toBe(true);
    expect(executionAllowedForJourney('arrival_pending_verification')).toBe(true);
    expect(executionAllowedForJourney('closed')).toBe(false);
  });

  test('restricts activity execution to the named assignee, assigned duty role or dispatcher', () => {
    const item = { responsible_user_id: 'assigned-user', responsible_role: 'cpo' };
    expect(canExecuteItem({ id: 'assigned-user', role: 'operator' }, ['driver'], item)).toBe(true);
    expect(canExecuteItem({ id: 'other-user', role: 'operator' }, ['cpo'], item)).toBe(true);
    expect(canExecuteItem({ id: 'other-user', role: 'operator' }, ['driver'], item)).toBe(false);
    expect(canExecuteItem({ id: 'other-user', role: 'operator' }, ['dispatcher'], item)).toBe(true);
    expect(canExecuteItem({ id: 'other-user', role: 'admin' }, [], item)).toBe(true);
    expect(canExecuteItem({ id: 'other-user', role: 'operator' }, ['driver'], {
      responsible_user_id: null, responsible_role: null,
    })).toBe(false);
  });

  test('validates timed programme activities, links and a single local programme day', () => {
    const activity = itemInput({
      item_type: 'transfer',
      title: 'Airport to hotel transfer',
      description: 'Controlled transfer to the confirmed accommodation.',
      location_label: 'Paris Charles de Gaulle Airport',
      location_lat: 48.9984,
      location_lng: 2.4147,
      traveller_id: '30000000-0000-4000-8000-000000000001',
      planned_start_at: '2026-11-01T08:00:00.000Z',
      planned_end_at: '2026-11-01T09:00:00.000Z',
      responsible_role: 'driver',
    }, 'Africa/Nairobi');
    expect(activity.error).toBeUndefined();
    expect(activity.value).toMatchObject({
      item_type: 'transfer',
      title: 'Airport to hotel transfer',
      responsible_role: 'driver',
      location_lat: 48.9984,
      location_lng: 2.4147,
      traveller_id: '30000000-0000-4000-8000-000000000001',
    });
  });

  test('rejects invalid activity ownership, relationships, timezone windows and roles', () => {
    const base = {
      title: 'Security briefing',
      planned_start_at: '2026-11-01T08:00:00.000Z',
      planned_end_at: '2026-11-01T09:00:00.000Z',
    };
    expect(itemInput({ ...base, responsible_user_id: 'not-a-uuid' }, 'Africa/Nairobi').error).toBe('invalid_responsible_user');
    expect(itemInput({ ...base, traveller_id: 'not-a-uuid' }, 'Africa/Nairobi').error).toBe('traveller_not_found');
    expect(itemInput({ ...base, location_lat: 91, location_lng: 2 }, 'Africa/Nairobi').error).toBe('invalid_itinerary_item_coordinates');
    expect(itemInput({ ...base, location_lat: 1 }, 'Africa/Nairobi').error).toBe('invalid_itinerary_item_coordinates');
    expect(itemInput({ ...base, flight_segment_id: 'not-a-uuid' }, 'Africa/Nairobi').error).toBe('flight_segment_not_found');
    expect(itemInput({ ...base, responsible_role: 'superuser' }, 'Africa/Nairobi').error).toBe('invalid_responsible_role');
    expect(itemInput({ ...base, planned_end_at: '2026-11-02T09:00:00.000Z' }, 'Africa/Nairobi').error).toBe('itinerary_item_must_fit_one_local_day');
  });

  test('accepts only timezone-qualified ISO instants and explicit IANA zones', () => {
    expect(dateOnly('2026-11-01')).toBe(true);
    expect(dateOnly('2026-02-30')).toBe(false);
    expect(dateOnly('01-11-2026')).toBe(false);
    expect(validTimestamp('2026-11-01T08:00:00.000Z')).toBe(true);
    expect(validTimestamp('2026-11-01T08:00:00+03:00')).toBe(true);
    expect(validTimestamp('2026-11-01T08:00:00')).toBe(false);
    expect(validTimestamp('2026-02-30T08:00:00.000Z')).toBe(false);
    expect(validTimezone('Africa/Nairobi')).toBe(true);
    expect(validTimezone('Not/A_Timezone')).toBe(false);
    expect(localDate('2026-11-01T08:00:00.000Z', 'Africa/Nairobi')).toBe('2026-11-01');
  });

  test('supports domain-specific SJM movement and security programme activities', () => {
    expect(ITEM_TYPES.has('airport_arrival')).toBe(true);
    expect(ITEM_TYPES.has('meet_and_greet')).toBe(true);
    expect(ITEM_TYPES.has('close_protection')).toBe(true);
    expect(ITEM_TYPES.has('security_escort')).toBe(true);
    expect(ITEM_TYPES.has('vehicle_handover')).toBe(true);
    expect(ITEM_TYPES.has('hotel_check_in')).toBe(true);
  });

  test('supports travel-document, itinerary and boarding-pass records', () => {
    expect(DOCUMENT_TYPES.has('passport')).toBe(true);
    expect(DOCUMENT_TYPES.has('visa')).toBe(true);
    expect(DOCUMENT_TYPES.has('boarding_pass')).toBe(true);
    expect(DOCUMENT_TYPES.has('itinerary')).toBe(true);
    expect(DOCUMENT_TYPES.has('travel_insurance')).toBe(true);
  });
});
