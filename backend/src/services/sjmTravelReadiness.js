'use strict';

const AIRPORT_SERVICES = new Set(['airport_arrival', 'airport_departure', 'meet_and_greet']);

function localDate(value, timezone) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const read = key => parts.find(part => part.type === key)?.value || '';
    return read('year') + '-' + read('month') + '-' + read('day');
  } catch {
    return null;
  }
}

function calendarDates(start, end) {
  if (!start || !end || end < start) return [];
  const dates = [];
  const cursor = new Date(start + 'T00:00:00.000Z');
  const finish = new Date(end + 'T00:00:00.000Z');
  if (!Number.isFinite(cursor.getTime()) || !Number.isFinite(finish.getTime())) return [];
  for (let count = 0; cursor <= finish && count < 366; count += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function evaluateTravelReadiness({ journey, travellers = [], flights = [], days = [], documents = [] }, phase = 'departure') {
  const blockers = [];
  const warnings = [];
  const principals = travellers.filter(person => person.traveller_type === 'principal');
  if (principals.length === 0) {
    blockers.push({ code: 'principal_traveller_missing', message: 'Register one principal traveller before route approval or departure release.' });
  } else if (principals.length > 1) {
    blockers.push({ code: 'principal_traveller_ambiguous', message: 'Exactly one principal traveller must be designated for this journey.' });
  }

  let uncoveredTravellerCount = 0;
  if (AIRPORT_SERVICES.has(String(journey.service_type || ''))) {
    const usableFlights = flights.filter(segment => !['cancelled', 'diverted'].includes(segment.status));
    if (travellers.length === 0 || usableFlights.length === 0) {
      uncoveredTravellerCount = Math.max(1, travellers.length);
    } else if (!usableFlights.some(segment => segment.traveller_id == null)) {
      uncoveredTravellerCount = travellers.filter(traveller =>
        !usableFlights.some(segment => segment.traveller_id === traveller.id),
      ).length;
    }
    if (uncoveredTravellerCount > 0) {
      blockers.push({
        code: 'airport_flight_details_incomplete',
        message: 'Every registered traveller on an airport movement needs a non-cancelled flight segment, or a shared segment covering the party.',
        uncovered_traveller_count: uncoveredTravellerCount,
      });
    }
  }

  let activityCount = days.reduce((sum, day) => sum + Number(day.activity_count || 0), 0);
  const unassignedActivityCount = days.reduce((sum, day) => sum + Number(day.unassigned_activity_count || 0), 0);
  const datedDays = new Set(days.filter(day => Number(day.activity_count || 0) > 0).map(day => String(day.journey_date).slice(0, 10)));
  let requiredDates = [];
  if (phase === 'departure') {
    const timezone = journey.timezone;
    const start = localDate(journey.planned_departure_at, timezone);
    const end = localDate(journey.planned_arrival_at, timezone);
    if (!start || !end || end < start) {
      blockers.push({ code: 'journey_schedule_missing', message: 'Set valid planned departure and arrival times before completing the daily travel programme.' });
    } else {
      requiredDates = calendarDates(start, end);
      if (requiredDates.length === 0 || requiredDates.length >= 366) {
        blockers.push({ code: 'journey_schedule_range_invalid', message: 'The mission date range is invalid or exceeds the supported 365-day programme window.' });
      } else {
        const missingDates = requiredDates.filter(date => !datedDays.has(date));
        if (missingDates.length > 0) {
          blockers.push({
            code: 'daily_programme_incomplete',
            message: 'Every local calendar day between planned departure and arrival needs a programme day with at least one timed activity.',
            missing_dates: missingDates,
          });
        }
      }
      if (unassignedActivityCount > 0) {
        blockers.push({ code: 'daily_programme_unassigned', message: 'Assign a named mission team member or accountable duty role to every timed activity.', unassigned_activity_count: unassignedActivityCount });
      }
    }
  } else if (phase === 'approval') {
    if (days.length > 0 && activityCount === 0) {
      warnings.push({ code: 'programme_days_have_no_activities', message: 'Programme days exist but do not yet contain timed activities.' });
    }
  }

  let documentBlockerCount = 0;
  let expiringDocumentCount = 0;
  if (documents.length === 0) {
    warnings.push({
      code: 'no_travel_documents_recorded',
      message: 'No travel documents are registered. Confirm the passport, visa, ticket and insurance requirements applicable to this route before departure.',
    });
  }
  const arrivalDate = localDate(journey.planned_arrival_at, journey.timezone);
  const today = localDate(new Date().toISOString(), journey.timezone) || new Date().toISOString().slice(0, 10);
  const expiryHorizon = new Date(today + 'T00:00:00.000Z');
  expiryHorizon.setUTCDate(expiryHorizon.getUTCDate() + 90);
  const horizonDate = expiryHorizon.toISOString().slice(0, 10);
  for (const document of documents) {
    const statusReady = document.review_status === 'VERIFIED' && document.evidence_status === 'VERIFIED';
    const expiresBeforeJourney = document.expiry_date &&
      String(document.expiry_date).slice(0, 10) < (arrivalDate || today);
    if (!statusReady || expiresBeforeJourney || document.review_status === 'EXPIRED') {
      documentBlockerCount += 1;
    } else if (document.expiry_date &&
      String(document.expiry_date).slice(0, 10) <= horizonDate) {
      expiringDocumentCount += 1;
    }
  }
  if (documentBlockerCount > 0) {
    blockers.push({
      code: 'travel_documents_not_cleared',
      message: 'One or more uploaded travel documents are pending review, rejected, unverified or expire before the planned arrival.',
      document_count: documentBlockerCount,
    });
  }
  if (expiringDocumentCount > 0) {
    warnings.push({
      code: 'travel_documents_expiring_soon',
      message: 'One or more verified travel documents expire within 90 days.',
      document_count: expiringDocumentCount,
    });
  }

  return {
    phase,
    ready: blockers.length === 0,
    blockers,
    warnings,
    counts: {
      traveller_count: travellers.length,
      principal_traveller_count: principals.length,
      flight_segment_count: flights.length,
      programme_day_count: days.length,
      timed_activity_count: activityCount,
      unassigned_activity_count: unassignedActivityCount,
      required_programme_day_count: requiredDates.length,
      cleared_document_count: documents.filter(document =>
        document.review_status === 'VERIFIED' && document.evidence_status === 'VERIFIED',
      ).length,
      document_blocker_count: documentBlockerCount,
      expiring_document_count: expiringDocumentCount,
    },
  };
}

async function loadTravelReadiness(db, journey, phase = 'departure') {
  const org = journey.org_id, id = journey.id;
  const travellerResult = await db(
    'SELECT id,traveller_type FROM sjm_travellers WHERE org_id=$1 AND journey_id=$2 AND deleted_at IS NULL',
    [org, id],
  );
  const flightResult = await db(
    'SELECT id,traveller_id,status FROM sjm_flight_segments WHERE org_id=$1 AND journey_id=$2 AND deleted_at IS NULL',
    [org, id],
  );
  const dayResult = await db(
    'SELECT d.id,d.journey_date,COUNT(i.id)::int AS activity_count,COUNT(i.id) FILTER (WHERE i.id IS NOT NULL AND COALESCE(NULLIF(BTRIM(i.responsible_role),\'\'),\'\')=\'\' AND (i.responsible_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM sjm_journey_participants p JOIN users u ON u.id=p.user_id AND u.org_id=p.org_id AND u.deleted_at IS NULL AND u.status=\'active\' WHERE p.org_id=i.org_id AND p.journey_id=i.journey_id AND p.user_id=i.responsible_user_id AND p.removed_at IS NULL)))::int AS unassigned_activity_count FROM sjm_itinerary_days d ' +
    'LEFT JOIN sjm_itinerary_items i ON i.org_id=d.org_id AND i.journey_id=d.journey_id AND i.day_id=d.id AND i.deleted_at IS NULL ' +
    'WHERE d.org_id=$1 AND d.journey_id=$2 AND d.deleted_at IS NULL GROUP BY d.id,d.journey_date ORDER BY d.journey_date',
    [org, id],
  );
  const documentResult = await db(
    'SELECT d.document_type,d.review_status,d.expiry_date,e.status AS evidence_status ' +
    'FROM sjm_travel_documents d JOIN sjm_evidence e ON e.id=d.evidence_id AND e.org_id=d.org_id AND e.journey_id=d.journey_id ' +
    'WHERE d.org_id=$1 AND d.journey_id=$2 AND d.deleted_at IS NULL AND e.deleted_at IS NULL',
    [org, id],
  );
  return evaluateTravelReadiness({
    journey,
    travellers: travellerResult.rows,
    flights: flightResult.rows,
    days: dayResult.rows,
    documents: documentResult.rows,
  }, phase);
}

module.exports = { AIRPORT_SERVICES, localDate, calendarDates, evaluateTravelReadiness, loadTravelReadiness };
