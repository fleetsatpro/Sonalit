'use strict';

const express = require('express');
const crypto = require('crypto');
const { asyncHandler } = require('../middleware/error');
const storage = require('../services/sjmEvidenceStorage');

const router = express.Router({ mergeParams: true });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MANAGERS = new Set(['admin', 'dispatcher']);
const DUTY_ROLES = new Set(['driver', 'backup_driver', 'cpo', 'meet_greet', 'security_escort', 'dispatcher']);
const TERMINAL = new Set(['closed', 'cancelled', 'aborted']);
const TRAVELLER_TYPES = new Set(['principal', 'accompanying', 'assistant', 'dependent', 'other']);
const DOCUMENT_TYPES = new Set(['passport', 'visa', 'e_ticket', 'booking_confirmation', 'travel_insurance', 'invitation_letter', 'residence_permit', 'other']);
const FLIGHT_STATUSES = new Set(['scheduled', 'boarding', 'departed', 'delayed', 'landed', 'cancelled', 'diverted', 'unknown']);
const ITEM_TYPES = new Set(['flight', 'transfer', 'meeting', 'security_briefing', 'hotel', 'checkpoint', 'rest', 'event', 'other']);
const EXECUTION_STATES = new Set(['planned', 'in_progress', 'completed', 'delayed', 'skipped', 'exception']);
const MIME_LIMITS = Object.freeze({ 'application/pdf': 25 * 1024 * 1024, 'image/jpeg': 20 * 1024 * 1024, 'image/png': 20 * 1024 * 1024 });
const TERMINAL_MESSAGE = 'The journey is closed, cancelled or aborted; its travel plan is read-only.';

function txt(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function manager(user) {
  return !!user && MANAGERS.has(String(user.role || '').toLowerCase());
}
function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function validTimestamp(value) {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
}
function validTimezone(value) {
  if (typeof value !== 'string' || value.length > 100) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date()); return true; } catch { return false; }
}
function localDate(value, timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(value));
    const take = key => parts.find(part => part.type === key)?.value || '';
    return take('year') + '-' + take('month') + '-' + take('day');
  } catch { return ''; }
}
function travellerInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_traveller' };
  const given = txt(body.given_name, 100), family = txt(body.family_name, 100);
  const type = txt(body.traveller_type, 24) || 'principal';
  const reference = txt(body.traveller_reference, 48);
  const dob = body.date_of_birth == null || body.date_of_birth === '' ? null : body.date_of_birth;
  if (!given || !family) return { error: 'traveller_name_required' };
  if (!TRAVELLER_TYPES.has(type)) return { error: 'invalid_traveller_type' };
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,47}$/.test(reference)) return { error: 'invalid_traveller_reference' };
  if (dob && (!dateOnly(dob) || dob > new Date().toISOString().slice(0, 10))) return { error: 'invalid_date_of_birth' };
  const email = txt(body.email, 254).toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'invalid_traveller_email' };
  const phone = txt(body.phone, 48) || null;
  const emergencyPhone = txt(body.emergency_contact_phone, 48) || null;
  for (const phoneValue of [phone, emergencyPhone]) {
    if (phoneValue && !/^[+0-9().\-\s]{5,48}$/.test(phoneValue)) return { error: 'invalid_traveller_phone' };
  }
  return { value: {
    traveller_reference: reference, traveller_type: type,
    title: txt(body.title, 24) || null, given_name: given,
    middle_name: txt(body.middle_name, 100) || null, family_name: family,
    preferred_name: txt(body.preferred_name, 100) || null,
    nationality: txt(body.nationality, 80) || null, date_of_birth: dob,
    email, phone,
    emergency_contact_name: txt(body.emergency_contact_name, 160) || null,
    emergency_contact_phone: emergencyPhone,
    internal_notes: txt(body.internal_notes, 1200) || null,
  } };
}
function flightInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_flight_segment' };
  const carrier = txt(body.carrier, 120), flight = txt(body.flight_number, 24).toUpperCase();
  const dep = txt(body.departure_airport, 4).toUpperCase(), arr = txt(body.arrival_airport, 4).toUpperCase();
  const depAt = body.departure_at, arrAt = body.arrival_at;
  const depTz = txt(body.departure_timezone, 100), arrTz = txt(body.arrival_timezone, 100);
  if (!carrier || !/^[A-Z0-9][A-Z0-9 -]{0,23}$/.test(flight)) return { error: 'flight_carrier_and_number_required' };
  if (!/^[A-Z0-9]{3,4}$/.test(dep) || !/^[A-Z0-9]{3,4}$/.test(arr)) return { error: 'invalid_flight_airport_code' };
  if (!validTimestamp(depAt) || !validTimestamp(arrAt) || Date.parse(arrAt) <= Date.parse(depAt)) return { error: 'invalid_flight_time_window' };
  if (!validTimezone(depTz) || !validTimezone(arrTz)) return { error: 'invalid_flight_timezone' };
  return { value: {
    carrier, flight_number: flight, departure_airport: dep, arrival_airport: arr,
    departure_airport_name: txt(body.departure_airport_name, 180) || null,
    departure_terminal: txt(body.departure_terminal, 80) || null,
    departure_gate: txt(body.departure_gate, 32) || null,
    departure_at: new Date(depAt).toISOString(), departure_timezone: depTz,
    arrival_airport_name: txt(body.arrival_airport_name, 180) || null,
    arrival_terminal: txt(body.arrival_terminal, 80) || null,
    arrival_gate: txt(body.arrival_gate, 32) || null,
    arrival_at: new Date(arrAt).toISOString(), arrival_timezone: arrTz,
    booking_reference: txt(body.booking_reference, 80) || null,
    traveller_id: body.traveller_id || null,
  } };
}
function itemInput(body, timezone) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_itinerary_item' };
  const title = txt(body.title, 180);
  const type = txt(body.item_type, 24) || 'other';
  const start = body.planned_start_at, end = body.planned_end_at;
  if (!title) return { error: 'itinerary_item_title_required' };
  if (!ITEM_TYPES.has(type)) return { error: 'invalid_itinerary_item_type' };
  if (!validTimestamp(start) || !validTimestamp(end) || Date.parse(end) <= Date.parse(start)) return { error: 'invalid_itinerary_item_time_window' };
  const lat = body.location_lat == null || body.location_lat === '' ? null : Number(body.location_lat);
  const lng = body.location_lng == null || body.location_lng === '' ? null : Number(body.location_lng);
  if ((lat == null) !== (lng == null) || (lat != null && (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180))) return { error: 'invalid_itinerary_item_coordinates' };
  if (localDate(start, timezone) !== localDate(end, timezone)) return { error: 'itinerary_item_must_fit_one_local_day' };
  if (body.sequence != null && (!Number.isInteger(body.sequence) || body.sequence < 1 || body.sequence > 100)) return { error: 'invalid_itinerary_item_sequence' };
  return { value: {
    title, item_type: type, description: txt(body.description, 2000) || null,
    location_label: txt(body.location_label, 240) || null,
    location_lat: lat, location_lng: lng,
    planned_start_at: new Date(start).toISOString(), planned_end_at: new Date(end).toISOString(),
    responsible_user_id: body.responsible_user_id || null,
    responsible_role: txt(body.responsible_role, 48) || null,
    flight_segment_id: body.flight_segment_id || null,
    sequence: body.sequence || null,
  } };
}

async function access(db, req, lock = 'FOR SHARE') {
  const id = String(req.params.id || '');
  if (!UUID.test(id)) return { error: 'journey_not_found' };
  const row = await db(
    'SELECT id,status,timezone FROM sjm_journeys WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL ' + lock,
    [id, req.user.org_id],
  );
  if (!row.rows.length) return { error: 'journey_not_found' };
  const roles = manager(req.user) ? [] : (await db(
    'SELECT duty_role FROM sjm_journey_participants WHERE org_id=$1 AND journey_id=$2 AND user_id=$3 AND removed_at IS NULL',
    [req.user.org_id, id, req.user.id],
  )).rows.map(row => row.duty_role);
  if (!manager(req.user) && !roles.some(role => DUTY_ROLES.has(role))) return { error: 'journey_not_found' };
  return { journey: row.rows[0], roles };
}
function responseError(res, result) {
  if (!result?.error) return false;
  if (result.error === 'journey_not_found') res.status(404).json({ error: 'journey_not_found' });
  else if (result.error === 'traveller_not_found') res.status(404).json({ error: 'traveller_not_found' });
  else if (result.error === 'flight_segment_not_found') res.status(404).json({ error: 'flight_segment_not_found' });
  else if (result.error === 'itinerary_day_not_found') res.status(404).json({ error: 'itinerary_day_not_found' });
  else if (result.error === 'itinerary_item_not_found') res.status(404).json({ error: 'itinerary_item_not_found' });
  else if (result.error === 'journey_terminal') res.status(409).json({ error: 'journey_terminal', message: TERMINAL_MESSAGE });
  else if (result.error === 'forbidden') res.status(403).json({ error: 'travel_workspace_forbidden' });
  else if (result.error === 'document_not_ready') res.status(409).json({ error: 'travel_document_not_ready' });
  else if (result.error === 'invalid_transition') res.status(409).json({ error: 'invalid_execution_transition', message: result.message });
  else if (result.error === 'conflict') res.status(409).json({ error: 'travel_workspace_conflict', message: result.message || 'The record conflicts with an existing entry.' });
  else return false;
  return true;
}
async function audit(db, req, journeyId, action, subjectId = null, detail = {}) {
  await db(
    'INSERT INTO sjm_travel_workspace_events (org_id,journey_id,actor_id,action,subject_id,detail) VALUES ($1,$2,$3,$4,$5,$6)',
    [req.user.org_id, journeyId, req.user.id, action, subjectId, JSON.stringify(detail)],
  );
}
function managerOnly(req, res, next) {
  if (!manager(req.user)) return res.status(403).json({ error: 'travel_workspace_forbidden' });
  next();
}
function activeDuty(roles) {
  return Array.isArray(roles) && roles.some(role => DUTY_ROLES.has(role));
}
function routeResultStatus(res, outcome, successStatus = 200) {
  if (responseError(res, outcome)) return false;
  res.status(successStatus).json({ data: outcome.data });
  return true;
}

router.get('/', asyncHandler(async (req, res) => {
  const result = await req.dbTx(async client => {
    const db = (sql, params) => client.query(sql, params);
    const current = await access(db, req);
    if (current.error) return current;
    const org = req.user.org_id, id = current.journey.id, isManager = manager(req.user);
    const travellerRows = await db(
      isManager
        ? 'SELECT t.id,t.traveller_reference,t.traveller_type,t.title,t.given_name,t.middle_name,t.family_name,t.preferred_name,t.nationality,t.date_of_birth,t.email,t.phone,t.emergency_contact_name,t.emergency_contact_phone,t.internal_notes,t.created_at,t.updated_at,concat_ws(\' \',t.title,t.given_name,t.middle_name,t.family_name) AS display_name FROM sjm_travellers t WHERE t.org_id=$1 AND t.journey_id=$2 AND t.deleted_at IS NULL ORDER BY t.created_at,t.id'
        : 'SELECT t.id,t.traveller_reference,t.traveller_type,concat_ws(\' \',t.title,t.preferred_name,t.given_name,t.family_name) AS display_name FROM sjm_travellers t WHERE t.org_id=$1 AND t.journey_id=$2 AND t.deleted_at IS NULL ORDER BY t.created_at,t.id',
      [org, id],
    );
    let travellers = travellerRows.rows;
    let documents = [];
    if (isManager) {
      const docs = await db(
        'SELECT d.id,d.traveller_id,d.document_type,d.holder_name,d.issuing_country,d.issue_date,d.expiry_date,d.review_status,d.review_note,d.reviewed_at,d.evidence_id,e.file_name,e.mime_type,e.size_bytes,e.sha256,e.verified_at FROM sjm_travel_documents d JOIN sjm_evidence e ON e.id=d.evidence_id AND e.org_id=d.org_id AND e.journey_id=d.journey_id WHERE d.org_id=$1 AND d.journey_id=$2 AND d.deleted_at IS NULL AND e.deleted_at IS NULL ORDER BY d.created_at DESC,d.id',
        [org, id],
      );
      documents = docs.rows;
      await audit(db, req, id, 'TRAVELLER_REGISTER_VIEWED', null, { record_count: travellers.length });
      await audit(db, req, id, 'TRAVEL_DOCUMENT_REGISTER_VIEWED', null, { record_count: documents.length });
    }
    const flightResult = await db(
      'SELECT f.id,f.traveller_id,f.sequence,f.carrier,f.flight_number,f.departure_airport,f.departure_airport_name,f.departure_terminal,f.departure_gate,f.departure_at,f.departure_timezone,f.arrival_airport,f.arrival_airport_name,f.arrival_terminal,f.arrival_gate,f.arrival_at,f.arrival_timezone,' +
      'CASE WHEN $3::boolean THEN f.booking_reference ELSE NULL END AS booking_reference,f.status,f.status_source,f.status_observed_at,f.status_note ' +
      'FROM sjm_flight_segments f WHERE f.org_id=$1 AND f.journey_id=$2 AND f.deleted_at IS NULL ORDER BY f.sequence,f.id',
      [org, id, isManager],
    );
    const dayResult = await db(
      'SELECT d.id,d.journey_date,d.timezone,d.day_title,d.briefing,d.operational_notes ' +
      'FROM sjm_itinerary_days d WHERE d.org_id=$1 AND d.journey_id=$2 AND d.deleted_at IS NULL ORDER BY d.journey_date,d.id',
      [org, id],
    );
    const itemResult = await db(
      'SELECT i.id,i.day_id,i.sequence,i.item_type,i.title,i.description,i.location_label,i.location_lat,i.location_lng,i.planned_start_at,i.planned_end_at,i.responsible_user_id,i.responsible_role,i.flight_segment_id,i.execution_status,i.actual_start_at,i.actual_end_at,i.execution_note,u.name AS responsible_name ' +
      'FROM sjm_itinerary_items i LEFT JOIN users u ON u.id=i.responsible_user_id AND u.org_id=i.org_id AND u.deleted_at IS NULL ' +
      'WHERE i.org_id=$1 AND i.journey_id=$2 AND i.deleted_at IS NULL ORDER BY i.day_id,i.sequence,i.id',
      [org, id],
    );
    const byDay = new Map();
    for (const item of itemResult.rows) {
      const list = byDay.get(item.day_id) || [];
      list.push(item);
      byDay.set(item.day_id, list);
    }
    return { data: {
      travellers, documents, flights: flightResult.rows,
      days: dayResult.rows.map(day => ({ ...day, items: byDay.get(day.id) || [] })),
      access: { manager: isManager, duty_roles: current.roles },
      provenance: { traveller_records: 'SJM traveller register; personal details manager-only', travel_documents: isManager ? 'Private SJM evidence objects; requires dedicated private SJM R2 configuration' : 'Not exposed to field roles', flight_status: 'Operator-entered unless a separately identified provider observation is returned', itinerary_execution: 'Operator-recorded execution events; not device or GPS proof' },
    } };
  });
  if (responseError(res, result)) return;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: result.data });
}));

router.post('/travellers', managerOnly, asyncHandler(async (req, res) => {
  const normalized = travellerInput(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const result = await req.dbTx(async client => {
    const db = (sql, params) => client.query(sql, params);
    const current = await access(db, req, 'FOR UPDATE');
    if (current.error) return current;
    if (TERMINAL.has(current.journey.status)) return { error: 'journey_terminal' };
    const v = normalized.value;
    const inserted = await db(
      'INSERT INTO sjm_travellers (org_id,journey_id,traveller_reference,traveller_type,title,given_name,middle_name,family_name,preferred_name,nationality,date_of_birth,email,phone,emergency_contact_name,emergency_contact_phone,internal_notes,created_by,updated_by) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17) RETURNING id,traveller_reference,traveller_type,title,given_name,middle_name,family_name,preferred_name,nationality,date_of_birth,email,phone,emergency_contact_name,emergency_contact_phone,internal_notes,created_at,updated_at',
      [req.user.org_id,current.journey.id,v.traveller_reference,v.traveller_type,v.title,v.given_name,v.middle_name,v.family_name,v.preferred_name,v.nationality,v.date_of_birth,v.email,v.phone,v.emergency_contact_name,v.emergency_contact_phone,v.internal_notes,req.user.id],
    );
    await audit(db, req, current.journey.id, 'TRAVELLER_CREATED', inserted.rows[0].id, { traveller_reference: v.traveller_reference, traveller_type: v.traveller_type });
    return { data: inserted.rows[0] };
  });
  if (result.error === 'traveller_not_found') return res.status(404).json({ error: result.error });
  if (!routeResultStatus(res, result, 201)) return;
}));

router.patch('/travellers/:travellerId', managerOnly, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.travellerId)) return res.status(404).json({ error: 'traveller_not_found' });
  const normalized = travellerInput(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const result = await req.dbTx(async client => {
    const db = (sql, params) => client.query(sql, params);
    const current = await access(db, req, 'FOR UPDATE');
    if (current.error) return current;
    if (TERMINAL.has(current.journey.status)) return { error: 'journey_terminal' };
    const v = normalized.value;
    const saved = await db(
      'UPDATE sjm_travellers SET traveller_reference=$1,traveller_type=$2,title=$3,given_name=$4,middle_name=$5,family_name=$6,preferred_name=$7,nationality=$8,date_of_birth=$9,email=$10,phone=$11,emergency_contact_name=$12,emergency_contact_phone=$13,internal_notes=$14,updated_by=$15,updated_at=NOW() ' +
      'WHERE id=$16 AND org_id=$17 AND journey_id=$18 AND deleted_at IS NULL RETURNING id,traveller_reference,traveller_type,title,given_name,middle_name,family_name,preferred_name,nationality,date_of_birth,email,phone,emergency_contact_name,emergency_contact_phone,internal_notes,updated_at',
      [v.traveller_reference,v.traveller_type,v.title,v.given_name,v.middle_name,v.family_name,v.preferred_name,v.nationality,v.date_of_birth,v.email,v.phone,v.emergency_contact_name,v.emergency_contact_phone,v.internal_notes,req.user.id,req.params.travellerId,req.user.org_id,current.journey.id],
    );
    if (!saved.rows.length) return { error: 'traveller_not_found' };
    await audit(db, req, current.journey.id, 'TRAVELLER_UPDATED', req.params.travellerId, { traveller_reference: v.traveller_reference });
    return { data: saved.rows[0] };
  });
  if (responseError(res, result)) return;
  res.json({ data: result.data });
}));

router.post('/travellers/:travellerId/documents/upload-url', managerOnly, asyncHandler(async (req, res) => {
  const id = String(req.params.travellerId || '');
  if (!UUID.test(id)) return res.status(404).json({ error: 'traveller_not_found' });
  const body = req.body || {};
  const documentType = txt(body.document_type, 32).toLowerCase();
  const holderName = txt(body.holder_name, 180);
  const issuingCountry = txt(body.issuing_country, 80) || null;
  const issueDate = body.issue_date || null, expiryDate = body.expiry_date || null;
  const mime = txt(body.mime_type, 80).toLowerCase();
  const fileName = txt(body.file_name, 180).replace(/[\\/\x00-\x1f\x7f]/g, '_').replace(/^\.+/, '');
  const size = body.size_bytes;
  if (!DOCUMENT_TYPES.has(documentType) || !holderName) return res.status(400).json({ error: 'invalid_travel_document_metadata' });
  if (issueDate && !dateOnly(issueDate) || expiryDate && !dateOnly(expiryDate) || issueDate && expiryDate && expiryDate < issueDate) return res.status(400).json({ error: 'invalid_travel_document_dates' });
  if (!Object.prototype.hasOwnProperty.call(MIME_LIMITS, mime) || !Number.isSafeInteger(size) || size < 1 || size > MIME_LIMITS[mime] || !fileName) return res.status(400).json({ error: 'invalid_travel_document_file', max_bytes: MIME_LIMITS[mime] || null });
  const evidenceId = crypto.randomUUID();
  const extension = mime === 'application/pdf' ? 'pdf' : mime === 'image/jpeg' ? 'jpg' : 'png';
  try {
    const result = await req.dbTx(async client => {
      const db = (sql, params) => client.query(sql, params);
      const current = await access(db, req, 'FOR UPDATE');
      if (current.error) return current;
      if (TERMINAL.has(current.journey.status)) return { error: 'journey_terminal' };
      const traveller = await db('SELECT id FROM sjm_travellers WHERE id=$1 AND org_id=$2 AND journey_id=$3 AND deleted_at IS NULL FOR UPDATE', [id,req.user.org_id,current.journey.id]);
      if (!traveller.rows.length) return { error: 'traveller_not_found' };
      const storageKey = 'orgs/' + req.user.org_id + '/sjm/' + current.journey.id + '/travel-documents/' + id + '/' + evidenceId + '.' + extension;
      const signed = await storage.createUploadUrl({ key: storageKey, mimeType: mime, evidenceId, journeyId: current.journey.id });
      await db(
        'INSERT INTO sjm_evidence (id,org_id,journey_id,category,file_name,mime_type,size_bytes,storage_key,status,access_classification,created_by) ' +
        "VALUES ($1,$2,$3,'document',$4,$5,$6,$7,'UPLOAD_PENDING','HIGHLY_SENSITIVE',$8)",
        [evidenceId,req.user.org_id,current.journey.id,fileName,mime,size,storageKey,req.user.id],
      );
      const doc = await db(
        'INSERT INTO sjm_travel_documents (org_id,journey_id,traveller_id,evidence_id,document_type,holder_name,issuing_country,issue_date,expiry_date,created_by) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,review_status,evidence_id',
        [req.user.org_id,current.journey.id,id,evidenceId,documentType,holderName,issuingCountry,issueDate,expiryDate,req.user.id],
      );
      await db(
        "INSERT INTO sjm_evidence_events (org_id,journey_id,evidence_id,actor_id,action,detail) VALUES ($1,$2,$3,$4,'UPLOAD_REQUESTED',$5)",
        [req.user.org_id,current.journey.id,evidenceId,req.user.id,JSON.stringify({ category:'document', access_classification:'HIGHLY_SENSITIVE', document_type:documentType })],
      );
      await audit(db, req, current.journey.id, 'TRAVEL_DOCUMENT_UPLOADED', doc.rows[0].id, { document_type: documentType, evidence_id: evidenceId });
      return { data: { ...doc.rows[0], ...signed } };
    });
    if (responseError(res, result)) return;
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({ data: result.data });
  } catch (error) {
    if (error?.code === 'storage_not_configured') return res.status(503).json({ error: 'travel_document_storage_unavailable', message: 'Travel-document upload is disabled until a dedicated private SJM R2 bucket and credentials are configured. No public or shared bucket fallback is permitted.' });
    throw error;
  }
}));

router.patch('/documents/:documentId/review', managerOnly, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.documentId)) return res.status(404).json({ error: 'travel_document_not_found' });
  const status = txt(req.body?.review_status, 24).toUpperCase();
  const note = txt(req.body?.review_note, 1000);
  if (!['VERIFIED','REJECTED'].includes(status) || note.length < 10) return res.status(400).json({ error: 'invalid_document_review', message: 'Choose verified or rejected and provide a meaningful review note.' });
  const result = await req.dbTx(async client => {
    const db = (sql, params) => client.query(sql, params);
    const current = await access(db, req, 'FOR UPDATE');
    if (current.error) return current;
    if (TERMINAL.has(current.journey.status)) return { error: 'journey_terminal' };
    const selected = await db(
      'SELECT d.id,d.review_status,d.evidence_id,e.status AS evidence_status FROM sjm_travel_documents d JOIN sjm_evidence e ON e.id=d.evidence_id AND e.org_id=d.org_id AND e.journey_id=d.journey_id WHERE d.id=$1 AND d.org_id=$2 AND d.journey_id=$3 AND d.deleted_at IS NULL FOR UPDATE OF d',
      [req.params.documentId,req.user.org_id,current.journey.id],
    );
    const doc = selected.rows[0];
    if (!doc) return { error: 'document_not_found' };
    if (doc.evidence_status !== 'VERIFIED' || doc.review_status !== 'PENDING_REVIEW') return { error: 'document_not_ready' };
    const updated = await db(
      'UPDATE sjm_travel_documents SET review_status=$1,review_note=$2,reviewed_by=$3,reviewed_at=NOW(),updated_at=NOW() WHERE id=$4 AND org_id=$5 AND journey_id=$6 RETURNING id,review_status,review_note,reviewed_at',
      [status,note,req.user.id,doc.id,req.user.org_id,current.journey.id],
    );
    await audit(db, req, current.journey.id, 'TRAVEL_DOCUMENT_REVIEWED', doc.id, { review_status: status });
    return { data: updated.rows[0] };
  });
  if (result.error === 'document_not_found') return res.status(404).json({ error: 'travel_document_not_found' });
  if (responseError(res, result)) return;
  res.json({ data: result.data });
}));

router.post('/flights', managerOnly, asyncHandler(async (req, res) => {
  const normalized = flightInput(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const result = await req.dbTx(async client => {
    const db = (sql, params) => client.query(sql, params);
    const current = await access(db, req, 'FOR UPDATE');
    if (current.error) return current;
    if (TERMINAL.has(current.journey.status)) return { error: 'journey_terminal' };
    const v = normalized.value;
    if (v.traveller_id && !UUID.test(String(v.traveller_id))) return { error: 'traveller_not_found' };
    if (v.traveller_id) {
      const t = await db('SELECT id FROM sjm_travellers WHERE id=$1 AND org_id=$2 AND journey_id=$3 AND deleted_at IS NULL', [v.traveller_id,req.user.org_id,current.journey.id]);
      if (!t.rows.length) return { error: 'traveller_not_found' };
    }
    const next = await db('SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM sjm_flight_segments WHERE org_id=$1 AND journey_id=$2 AND deleted_at IS NULL', [req.user.org_id,current.journey.id]);
    const inserted = await db(
      'INSERT INTO sjm_flight_segments (org_id,journey_id,traveller_id,sequence,carrier,flight_number,departure_airport,departure_airport_name,departure_terminal,departure_gate,departure_at,departure_timezone,arrival_airport,arrival_airport_name,arrival_terminal,arrival_gate,arrival_at,arrival_timezone,booking_reference,created_by,updated_by) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20) RETURNING *',
      [req.user.org_id,current.journey.id,v.traveller_id,next.rows[0].sequence,v.carrier,v.flight_number,v.departure_airport,v.departure_airport_name,v.departure_terminal,v.departure_gate,v.departure_at,v.departure_timezone,v.arrival_airport,v.arrival_airport_name,v.arrival_terminal,v.arrival_gate,v.arrival_at,v.arrival_timezone,v.booking_reference,req.user.id],
    );
    await audit(db, req, current.journey.id, 'FLIGHT_CREATED', inserted.rows[0].id, { sequence: inserted.rows[0].sequence, flight_number: v.flight_number });
    return { data: inserted.rows[0] };
  });
  if (responseError(res, result)) return;
  res.status(201).json({ data: result.data });
}));

router.patch('/flights/:flightId', managerOnly, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.flightId)) return res.status(404).json({ error: 'flight_segment_not_found' });
  const normalized = flightInput(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const result = await req.dbTx(async client => {
    const db = (sql, params) => client.query(sql, params);
    const current = await access(db, req, 'FOR UPDATE');
    if (current.error) return current;
    if (TERMINAL.has(current.journey.status)) return { error: 'journey_terminal' };
    const v = normalized.value;
    if (v.traveller_id) {
      const t = await db('SELECT id FROM sjm_travellers WHERE id=$1 AND org_id=$2 AND journey_id=$3 AND deleted_at IS NULL', [v.traveller_id,req.user.org_id,current.journey.id]);
      if (!t.rows.length) return { error: 'traveller_not_found' };
    }
    const saved = await db(
      'UPDATE sjm_flight_segments SET traveller_id=$1,carrier=$2,flight_number=$3,departure_airport=$4,departure_airport_name=$5,departure_terminal=$6,departure_gate=$7,departure_at=$8,departure_timezone=$9,arrival_airport=$10,arrival_airport_name=$11,arrival_terminal=$12,arrival_gate=$13,arrival_at=$14,arrival_timezone=$15,booking_reference=$16,updated_by=$17,updated_at=NOW() WHERE id=$18 AND org_id=$19 AND journey_id=$20 AND deleted_at IS NULL RETURNING *',
      [v.traveller_id,v.carrier,v.flight_number,v.departure_airport,v.departure_airport_name,v.departure_terminal,v.departure_gate,v.departure_at,v.departure_timezone,v.arrival_airport,v.arrival_airport_name,v.arrival_terminal,v.arrival_gate,v.arrival_at,v.arrival_timezone,v.booking_reference,req.user.id,req.params.flightId,req.user.org_id,current.journey.id],
    );
    if (!saved.rows.length) return { error: 'flight_segment_not_found' };
    await audit(db, req, current.journey.id, 'FLIGHT_UPDATED', req.params.flightId, { flight_number: v.flight_number });
    return { data: saved.rows[0] };
  });
  if (result.error === 'flight_segment_not_found') return res.status(404).json({ error: result.error });
  if (responseError(res, result)) return;
  res.json({ data: result.data });
}));

router.patch('/flights/:flightId/status', asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.flightId)) return res.status(404).json({ error: 'flight_segment_not_found' });
  const status = txt(req.body?.status, 24).toLowerCase();
  const note = txt(req.body?.note, 1000);
  if (!FLIGHT_STATUSES.has(status) || !note) return res.status(400).json({ error: 'invalid_flight_status', message: 'Choose a supported status and explain the observation.' });
  const result = await req.dbTx(async client => {
    const db = (sql, params) => client.query(sql, params);
    const current = await access(db, req, 'FOR UPDATE');
    if (current.error) return current;
    if (TERMINAL.has(current.journey.status)) return { error: 'journey_terminal' };
    if (!manager(req.user) && !activeDuty(current.roles)) return { error: 'forbidden' };
    const saved = await db(
      "UPDATE sjm_flight_segments SET status=$1,status_source='operator_entered',status_observed_at=NOW(),status_note=$2,updated_by=$3,updated_at=NOW() WHERE id=$4 AND org_id=$5 AND journey_id=$6 AND deleted_at IS NULL RETURNING id,status,status_source,status_observed_at,status_note",
      [status,note,req.user.id,req.params.flightId,req.user.org_id,current.journey.id],
    );
    if (!saved.rows.length) return { error: 'flight_segment_not_found' };
    await audit(db, req, current.journey.id, 'FLIGHT_UPDATED', req.params.flightId, { status, source: 'operator_entered' });
    return { data: saved.rows[0] };
  });
  if (result.error === 'flight_segment_not_found') return res.status(404).json({ error: result.error });
  if (responseError(res, result)) return;
  res.json({ data: result.data });
}));

router.post('/days', managerOnly, asyncHandler(async (req, res) => {
  const date = req.body?.journey_date, title = txt(req.body?.day_title, 180);
  if (!dateOnly(date) || !title) return res.status(400).json({ error: 'invalid_itinerary_day' });
  const result = await req.dbTx(async client => {
    const db = (sql, params) => client.query(sql, params);
    const current = await access(db, req, 'FOR UPDATE');
    if (current.error) return current;
    if (TERMINAL.has(current.journey.status)) return { error: 'journey_terminal' };
    const saved = await db(
      'INSERT INTO sjm_itinerary_days (org_id,journey_id,journey_date,timezone,day_title,briefing,operational_notes,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *',
      [req.user.org_id,current.journey.id,date,current.journey.timezone,title,txt(req.body?.briefing,3000)||null,txt(req.body?.operational_notes,3000)||null,req.user.id],
    );
    await audit(db, req, current.journey.id, 'DAY_CREATED', saved.rows[0].id, { journey_date: date });
    return { data: saved.rows[0] };
  });
  if (result.error === 'journey_terminal') return res.status(409).json({ error: result.error, message: TERMINAL_MESSAGE });
  if (result.error) {
    if (result.error === 'journey_not_found') return res.status(404).json({ error: result.error });
    if (result.error === 'conflict') return res.status(409).json({ error: result.error });
  }
  if (result.error) {
    if (result.error.code === '23505') return res.status(409).json({ error: 'travel_workspace_conflict', message: 'A programme day already exists for this local date.' });
    throw result.error;
  }
  res.status(201).json({ data: result.data });
}));

router.patch('/days/:dayId', managerOnly, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.dayId)) return res.status(404).json({ error: 'itinerary_day_not_found' });
  const title = txt(req.body?.day_title, 180);
  if (!title) return res.status(400).json({ error: 'itinerary_day_title_required' });
  const result = await req.dbTx(async client => {
    const db = (sql, params) => client.query(sql, params);
    const current = await access(db, req, 'FOR UPDATE');
    if (current.error) return current;
    if (TERMINAL.has(current.journey.status)) return { error: 'journey_terminal' };
    const saved = await db(
      'UPDATE sjm_itinerary_days SET day_title=$1,briefing=$2,operational_notes=$3,updated_by=$4,updated_at=NOW() WHERE id=$5 AND org_id=$6 AND journey_id=$7 AND deleted_at IS NULL RETURNING *',
      [title,txt(req.body?.briefing,3000)||null,txt(req.body?.operational_notes,3000)||null,req.user.id,req.params.dayId,req.user.org_id,current.journey.id],
    );
    if (!saved.rows.length) return { error: 'itinerary_day_not_found' };
    await audit(db, req, current.journey.id, 'DAY_UPDATED', req.params.dayId, {});
    return { data: saved.rows[0] };
  });
  if (responseError(res, result)) return;
  res.json({ data: result.data });
}));

router.post('/days/:dayId/items', managerOnly, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.dayId)) return res.status(404).json({ error: 'itinerary_day_not_found' });
  const result = await req.dbTx(async client => {
    const db = (sql, params) => client.query(sql, params);
    const current = await access(db, req, 'FOR UPDATE');
    if (current.error) return current;
    if (TERMINAL.has(current.journey.status)) return { error: 'journey_terminal' };
    const dayResult = await db('SELECT id,journey_date,timezone FROM sjm_itinerary_days WHERE id=$1 AND org_id=$2 AND journey_id=$3 AND deleted_at IS NULL FOR UPDATE', [req.params.dayId,req.user.org_id,current.journey.id]);
    const day = dayResult.rows[0];
    if (!day) return { error: 'itinerary_day_not_found' };
    const normalized = itemInput(req.body, day.timezone);
    if (normalized.error) return normalized;
    const v = normalized.value;
    if (localDate(v.planned_start_at, day.timezone) !== String(day.journey_date).slice(0,10)) return { error: 'itinerary_item_day_mismatch' };
    if (v.responsible_user_id) {
      if (!UUID.test(String(v.responsible_user_id))) return { error: 'invalid_responsible_user' };
      const assigned = await db('SELECT 1 FROM sjm_journey_participants WHERE org_id=$1 AND journey_id=$2 AND user_id=$3 AND removed_at IS NULL LIMIT 1', [req.user.org_id,current.journey.id,v.responsible_user_id]);
      if (!assigned.rows.length) return { error: 'responsible_user_not_assigned' };
    }
    if (v.flight_segment_id) {
      if (!UUID.test(String(v.flight_segment_id))) return { error: 'flight_segment_not_found' };
      const flight = await db('SELECT id FROM sjm_flight_segments WHERE id=$1 AND org_id=$2 AND journey_id=$3 AND deleted_at IS NULL', [v.flight_segment_id,req.user.org_id,current.journey.id]);
      if (!flight.rows.length) return { error: 'flight_segment_not_found' };
    }
    const sequenceResult = await db('SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM sjm_itinerary_items WHERE org_id=$1 AND journey_id=$2 AND day_id=$3 AND deleted_at IS NULL', [req.user.org_id,current.journey.id,day.id]);
    const sequence = v.sequence || sequenceResult.rows[0].sequence;
    const saved = await db(
      'INSERT INTO sjm_itinerary_items (org_id,journey_id,day_id,sequence,item_type,title,description,location_label,location_lat,location_lng,planned_start_at,planned_end_at,responsible_user_id,responsible_role,flight_segment_id,created_by,updated_by) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16) RETURNING *',
      [req.user.org_id,current.journey.id,day.id,sequence,v.item_type,v.title,v.description,v.location_label,v.location_lat,v.location_lng,v.planned_start_at,v.planned_end_at,v.responsible_user_id,v.responsible_role,v.flight_segment_id,req.user.id],
    );
    await db("INSERT INTO sjm_itinerary_item_events (org_id,journey_id,day_id,item_id,actor_id,action,detail) VALUES ($1,$2,$3,$4,$5,'PLAN_CREATED',$6)", [req.user.org_id,current.journey.id,day.id,saved.rows[0].id,req.user.id,JSON.stringify({ sequence, item_type: v.item_type })]);
    await audit(db, req, current.journey.id, 'PLAN_ITEM_CREATED', saved.rows[0].id, { day_id: day.id, sequence });
    return { data: saved.rows[0] };
  });
  if (result.error === 'itinerary_item_title_required' || result.error === 'invalid_itinerary_item_type' || result.error === 'invalid_itinerary_item_time_window' || result.error === 'invalid_itinerary_item_coordinates' || result.error === 'itinerary_item_must_fit_one_local_day' || result.error === 'invalid_itinerary_item_sequence') return res.status(400).json({ error: result.error });
  if (responseError(res, result)) return;
  res.status(201).json({ data: result.data });
}));

router.patch('/items/:itemId', managerOnly, asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.itemId)) return res.status(404).json({ error: 'itinerary_item_not_found' });
  const result = await req.dbTx(async client => {
    const db = (sql, params) => client.query(sql, params);
    const current = await access(db, req, 'FOR UPDATE');
    if (current.error) return current;
    if (TERMINAL.has(current.journey.status)) return { error: 'journey_terminal' };
    const existing = await db(
      'SELECT i.*,d.timezone,d.journey_date FROM sjm_itinerary_items i JOIN sjm_itinerary_days d ON d.id=i.day_id AND d.org_id=i.org_id AND d.journey_id=i.journey_id WHERE i.id=$1 AND i.org_id=$2 AND i.journey_id=$3 AND i.deleted_at IS NULL FOR UPDATE OF i',
      [req.params.itemId,req.user.org_id,current.journey.id],
    );
    if (!existing.rows.length) return { error: 'itinerary_item_not_found' };
    const normalized = itemInput(req.body, existing.rows[0].timezone);
    if (normalized.error) return normalized;
    const v = normalized.value;
    if (localDate(v.planned_start_at, existing.rows[0].timezone) !== String(existing.rows[0].journey_date).slice(0,10)) return { error: 'itinerary_item_day_mismatch' };
    if (v.responsible_user_id) {
      const assigned = await db('SELECT 1 FROM sjm_journey_participants WHERE org_id=$1 AND journey_id=$2 AND user_id=$3 AND removed_at IS NULL LIMIT 1', [req.user.org_id,current.journey.id,v.responsible_user_id]);
      if (!assigned.rows.length) return { error: 'responsible_user_not_assigned' };
    }
    if (v.flight_segment_id) {
      const flight = await db('SELECT id FROM sjm_flight_segments WHERE id=$1 AND org_id=$2 AND journey_id=$3 AND deleted_at IS NULL', [v.flight_segment_id,req.user.org_id,current.journey.id]);
      if (!flight.rows.length) return { error: 'flight_segment_not_found' };
    }
    const sequence = v.sequence || existing.rows[0].sequence;
    const saved = await db(
      'UPDATE sjm_itinerary_items SET sequence=$1,item_type=$2,title=$3,description=$4,location_label=$5,location_lat=$6,location_lng=$7,planned_start_at=$8,planned_end_at=$9,responsible_user_id=$10,responsible_role=$11,flight_segment_id=$12,sequence_revision=sequence_revision+1,updated_by=$13,updated_at=NOW() WHERE id=$14 AND org_id=$15 AND journey_id=$16 RETURNING *',
      [sequence,v.item_type,v.title,v.description,v.location_label,v.location_lat,v.location_lng,v.planned_start_at,v.planned_end_at,v.responsible_user_id,v.responsible_role,v.flight_segment_id,req.user.id,req.params.itemId,req.user.org_id,current.journey.id],
    );
    await db("INSERT INTO sjm_itinerary_item_events (org_id,journey_id,day_id,item_id,actor_id,action,previous_status,new_status,detail) VALUES ($1,$2,$3,$4,$5,'PLAN_UPDATED',$6,$6,$7)", [req.user.org_id,current.journey.id,existing.rows[0].day_id,req.params.itemId,req.user.id,existing.rows[0].execution_status,JSON.stringify({ sequence_revision: saved.rows[0].sequence_revision })]);
    await audit(db, req, current.journey.id, 'PLAN_ITEM_UPDATED', req.params.itemId, { sequence_revision: saved.rows[0].sequence_revision });
    return { data: saved.rows[0] };
  });
  if (responseError(res, result)) return;
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ data: result.data });
}));

router.patch('/items/:itemId/execution', asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.itemId)) return res.status(404).json({ error: 'itinerary_item_not_found' });
  const next = txt(req.body?.execution_status, 24).toLowerCase();
  const note = txt(req.body?.execution_note, 2000);
  if (!EXECUTION_STATES.has(next)) return res.status(400).json({ error: 'invalid_execution_status' });
  const result = await req.dbTx(async client => {
    const db = (sql, params) => client.query(sql, params);
    const current = await access(db, req, 'FOR UPDATE');
    if (current.error) return current;
    if (TERMINAL.has(current.journey.status)) return { error: 'journey_terminal' };
    if (!manager(req.user) && !activeDuty(current.roles)) return { error: 'forbidden' };
    const existing = await db(
      'SELECT i.id,i.day_id,i.execution_status,i.actual_start_at,i.actual_end_at,i.responsible_user_id FROM sjm_itinerary_items i WHERE i.id=$1 AND i.org_id=$2 AND i.journey_id=$3 AND i.deleted_at IS NULL FOR UPDATE',
      [req.params.itemId,req.user.org_id,current.journey.id],
    );
    const item = existing.rows[0];
    if (!item) return { error: 'itinerary_item_not_found' };
    const allowed = {
      planned: ['in_progress','delayed','skipped','exception'],
      in_progress: ['completed','delayed','exception'],
      delayed: ['in_progress','completed','skipped','exception'],
      exception: ['in_progress','completed','skipped'],
      completed: [],
      skipped: [],
    };
    if (item.execution_status !== next && !allowed[item.execution_status]?.includes(next)) {
      return { error: 'invalid_transition', message: 'Execution cannot move from ' + item.execution_status + ' to ' + next + '. Record a new plan revision instead.' };
    }
    if (item.execution_status === next && !note) return { error: 'invalid_transition', message: 'Add an execution note when appending an update without changing status.' };
    const actualStart = next === 'in_progress' ? (item.actual_start_at || new Date().toISOString()) : item.actual_start_at;
    const actualEnd = next === 'completed' || next === 'skipped' ? new Date().toISOString() : item.actual_end_at;
    const saved = await db(
      'UPDATE sjm_itinerary_items SET execution_status=$1,actual_start_at=$2,actual_end_at=$3,execution_note=CASE WHEN $4=\'\' THEN execution_note ELSE $4 END,updated_by=$5,updated_at=NOW() WHERE id=$6 AND org_id=$7 AND journey_id=$8 RETURNING id,execution_status,actual_start_at,actual_end_at,execution_note,updated_at',
      [next,actualStart,actualEnd,note,req.user.id,req.params.itemId,req.user.org_id,current.journey.id],
    );
    const action = next === 'in_progress' ? 'EXECUTION_STARTED' : next === 'completed' ? 'EXECUTION_COMPLETED' : next === 'delayed' ? 'EXECUTION_DELAYED' : next === 'skipped' ? 'EXECUTION_SKIPPED' : 'EXCEPTION_RAISED';
    await db(
      'INSERT INTO sjm_itinerary_item_events (org_id,journey_id,day_id,item_id,actor_id,action,previous_status,new_status,detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [req.user.org_id,current.journey.id,item.day_id,req.params.itemId,req.user.id,action,item.execution_status,next,JSON.stringify({ note, recorded_by_role: manager(req.user) ? req.user.role : current.roles })],
    );
    return { data: saved.rows[0] };
  });
  if (responseError(res, result)) return;
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ data: result.data });
}));

router.get('/items/:itemId/history', asyncHandler(async (req, res) => {
  if (!UUID.test(req.params.itemId)) return res.status(404).json({ error: 'itinerary_item_not_found' });
  const result = await req.dbTx(async client => {
    const db = (sql, params) => client.query(sql, params);
    const current = await access(db, req);
    if (current.error) return current;
    const selected = await db('SELECT id FROM sjm_itinerary_items WHERE id=$1 AND org_id=$2 AND journey_id=$3 AND deleted_at IS NULL', [req.params.itemId,req.user.org_id,current.journey.id]);
    if (!selected.rows.length) return { error: 'itinerary_item_not_found' };
    const events = await db('SELECT e.id,e.actor_id,u.name AS actor_name,e.action,e.previous_status,e.new_status,e.detail,e.observed_at FROM sjm_itinerary_item_events e LEFT JOIN users u ON u.id=e.actor_id AND u.org_id=e.org_id AND u.deleted_at IS NULL WHERE e.org_id=$1 AND e.journey_id=$2 AND e.item_id=$3 ORDER BY e.observed_at DESC,e.id DESC LIMIT 100', [req.user.org_id,current.journey.id,req.params.itemId]);
    return { data: events.rows };
  });
  if (responseError(res, result)) return;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: result.data });
}));

module.exports = router;
module.exports.__test = {
  travellerInput, flightInput, itemInput, dateOnly, validTimestamp, validTimezone,
  localDate, TRAVELLER_TYPES, DOCUMENT_TYPES, FLIGHT_STATUSES, ITEM_TYPES, EXECUTION_STATES,
};
