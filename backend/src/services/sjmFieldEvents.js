'use strict';

const DUTY_EVENT_RULES = Object.freeze({
  driver: Object.freeze(['driver_en_route','driver_at_pickup','principal_on_board','destination_reached','vehicle_issue','delay','safety_check_in']),
  backup_driver: Object.freeze(['driver_en_route','driver_at_pickup','principal_on_board','destination_reached','vehicle_issue','delay','safety_check_in']),
  cpo: Object.freeze(['cpo_en_route','meet_point_confirmed','principal_met','security_check_in','security_concern','delay','incident','handover_completed']),
  meet_greet: Object.freeze(['meet_greet_positioned','flight_status_observed','principal_contact_established','principal_received','handover_to_cpo','delay','incident','safety_check_in']),
  security_escort: Object.freeze(['escort_started','security_check_in','security_concern','delay','incident','handover_completed']),
  dispatcher: Object.freeze(['delay','incident','safety_check_in']),
});

const DUTY_EVENT_SUMMARIES = Object.freeze({
  driver_en_route:'Driver reported en route',
  driver_at_pickup:'Driver reported arrival at pickup',
  principal_on_board:'Driver reported principal on board',
  destination_reached:'Driver reported destination reached',
  vehicle_issue:'Driver reported a vehicle issue',
  delay:'Delay reported by field team',
  safety_check_in:'Field safety check-in recorded',
  cpo_en_route:'CPO reported en route',
  meet_point_confirmed:'CPO confirmed meet point',
  principal_met:'CPO reported principal met',
  security_check_in:'Security team check-in recorded',
  security_concern:'Security concern reported',
  incident:'Field incident reported',
  handover_completed:'CPO reported handover completed',
  meet_greet_positioned:'Meet-and-greet operator reported positioned',
  flight_status_observed:'Meet-and-greet operator reported flight information observed',
  principal_contact_established:'Meet-and-greet operator reported contact established',
  principal_received:'Meet-and-greet operator reported principal received',
  handover_to_cpo:'Meet-and-greet operator reported handover to CPO',
  escort_started:'Security escort reported started',
});

const NOTE_REQUIRED_EVENT_TYPES = new Set(['delay','vehicle_issue','incident','security_concern']);

function dutyEventAllowed(roles, eventType) {
  return Array.isArray(roles) && roles.some(role =>
    Array.isArray(DUTY_EVENT_RULES[role]) && DUTY_EVENT_RULES[role].includes(eventType)
  );
}

/** Shared validation for the online route and offline sync handler. */
function validateFieldEventInput(eventType, note) {
  const type = typeof eventType === 'string' ? eventType : '';
  if (!Object.prototype.hasOwnProperty.call(DUTY_EVENT_SUMMARIES, type)) {
    return {
      ok: false,
      status: 403,
      code: 'duty_action_not_permitted',
      message: 'This action is not available for this assigned duty role.',
    };
  }
  if (note != null && (typeof note !== 'string' || note.trim().length > 1200)) {
    return { ok: false, status: 400, code: 'invalid_note', message: 'Field note must be text no longer than 1200 characters.' };
  }
  const clean = typeof note === 'string' ? note.trim() : '';
  if (NOTE_REQUIRED_EVENT_TYPES.has(type) && clean.length < 5) {
    return { ok: false, status: 400, code: 'note_required', message: 'Provide at least five characters about the issue.' };
  }
  return { ok: true, eventType: type, note: clean };
}

module.exports = {
  DUTY_EVENT_RULES,
  DUTY_EVENT_SUMMARIES,
  NOTE_REQUIRED_EVENT_TYPES,
  dutyEventAllowed,
  validateFieldEventInput,
};
