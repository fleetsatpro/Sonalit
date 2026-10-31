'use strict';

const express = require('express');
const crypto = require('crypto');
const { asyncHandler } = require('../middleware/error');
const storage = require('../services/sjmEvidenceStorage');

const router = express.Router({ mergeParams: true });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL = new Set(['closed', 'cancelled', 'aborted']);
const MANAGERS = new Set(['admin', 'dispatcher']);
const UPLOAD_ROLES = new Set(['driver', 'backup_driver', 'cpo', 'meet_greet', 'security_escort', 'dispatcher']);
const CATEGORY_MIME_TYPES = Object.freeze({
  photo: ['image/jpeg', 'image/png'],
  video: ['video/mp4'],
  document: ['application/pdf'],
  incident_attachment: ['image/jpeg', 'image/png', 'video/mp4', 'application/pdf'],
  check_in: ['image/jpeg', 'image/png', 'application/pdf'],
  handover: ['image/jpeg', 'image/png', 'video/mp4', 'application/pdf'],
});
const MAX_BYTES = Object.freeze({
  'image/jpeg': 20 * 1024 * 1024,
  'image/png': 20 * 1024 * 1024,
  'video/mp4': 100 * 1024 * 1024,
  'application/pdf': 25 * 1024 * 1024,
});

function isManager(user) {
  return !!user && MANAGERS.has(String(user.role || '').toLowerCase());
}

function canViewEvidence(user, evidence) {
  return evidence?.access_classification !== 'HIGHLY_SENSITIVE' || isManager(user);
}

function canAccessJourney(user, roles) {
  return isManager(user) || (Array.isArray(roles) && roles.length > 0);
}

function canUploadEvidence(user, roles) {
  return isManager(user) || (Array.isArray(roles) && roles.some(role => UPLOAD_ROLES.has(role)));
}

function normalizeUploadInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_payload' };
  const category = typeof body.category === 'string' ? body.category.trim().toLowerCase() : '';
  const mimeType = typeof body.mime_type === 'string' ? body.mime_type.trim().toLowerCase() : '';
  if (!Object.prototype.hasOwnProperty.call(CATEGORY_MIME_TYPES, category)) return { error: 'invalid_evidence_category' };
  if (!CATEGORY_MIME_TYPES[category].includes(mimeType)) return { error: 'unsupported_evidence_type' };

  const sizeBytes = body.size_bytes;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_BYTES[mimeType]) {
    return { error: 'invalid_evidence_size', max_bytes: MAX_BYTES[mimeType] };
  }

  const fileName = typeof body.file_name === 'string'
    ? body.file_name.trim().replace(/[\\/\x00-\x1f\x7f]/g, '_').replace(/^\.+/, '').slice(0, 180)
    : '';
  if (!fileName) return { error: 'invalid_file_name' };

  let capturedAt = null;
  if (body.captured_at != null) {
    if (typeof body.captured_at !== 'string' || !Number.isFinite(Date.parse(body.captured_at))) {
      return { error: 'invalid_capture_timestamp' };
    }
    capturedAt = new Date(body.captured_at).toISOString();
  }

  let location = { lat: null, lng: null, accuracyM: null, source: 'NOT_CAPTURED' };
  if (body.location != null) {
    const l = body.location;
    if (!l || typeof l !== 'object' || Array.isArray(l) ||
        typeof l.latitude !== 'number' || !Number.isFinite(l.latitude) ||
        l.latitude < -90 || l.latitude > 90 ||
        typeof l.longitude !== 'number' || !Number.isFinite(l.longitude) ||
        l.longitude < -180 || l.longitude > 180 ||
        typeof l.accuracy_m !== 'number' || !Number.isFinite(l.accuracy_m) ||
        l.accuracy_m < 0 || l.accuracy_m > 5000) {
      return { error: 'invalid_location_observation' };
    }
    location = {
      lat: l.latitude,
      lng: l.longitude,
      accuracyM: l.accuracy_m,
      source: 'BROWSER_GEOLOCATION_UNVERIFIED',
    };
  }

  const deviceId = body.device_id == null ? null : (typeof body.device_id === 'string' ? body.device_id.trim() : '');
  if (body.device_id != null && (!deviceId || deviceId.length > 128 || /[\x00-\x1f\x7f]/.test(deviceId))) {
    return { error: 'invalid_device_reference' };
  }

  return {
    value: {
      category,
      mimeType,
      sizeBytes,
      fileName,
      deviceId,
      capturedAt,
      captureTimeQuality: capturedAt ? 'DEVICE_CLOCK_UNVERIFIED' : 'NOT_SUPPLIED',
      location,
    },
  };
}

function accessError(res, result) {
  if (!result || result.error === 'journey_not_found') {
    res.status(404).json({ error: 'journey_not_found' });
    return true;
  }
  if (result.error === 'evidence_not_found') {
    res.status(404).json({ error: 'evidence_not_found' });
    return true;
  }
  if (result.error === 'journey_terminal') {
    res.status(409).json({ error: 'journey_terminal', message: 'New evidence cannot be attached after journey closure, cancellation or abort.' });
    return true;
  }
  if (result.error === 'evidence_not_uploadable') {
    res.status(403).json({ error: 'evidence_upload_not_permitted' });
    return true;
  }
  if (result.error === 'evidence_not_verified') {
    res.status(409).json({ error: 'evidence_not_verified', message: 'The evidence object has not passed private-storage verification.' });
    return true;
  }
  return false;
}

async function lockJourneyAndRoles(db, orgId, journeyId, user, lockMode = 'FOR SHARE') {
  const lockClause = lockMode === 'FOR UPDATE' ? 'FOR UPDATE' : 'FOR SHARE';
  const journey = await db(
    'SELECT id,status FROM sjm_journeys WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL ' + lockClause,
    [journeyId, orgId],
  );
  if (!journey.rows.length) return { error: 'journey_not_found' };
  const assignment = await db(
    'SELECT duty_role FROM sjm_journey_participants WHERE org_id=$1 AND journey_id=$2 AND user_id=$3 AND removed_at IS NULL ORDER BY duty_role',
    [orgId, journeyId, user.id],
  );
  const roles = assignment.rows.map(row => row.duty_role);
  if (!canAccessJourney(user, roles)) return { error: 'journey_not_found' };
  return { journey: journey.rows[0], roles };
}

router.get('/', asyncHandler(async (req, res) => {
  const journeyId = String(req.params.id || '');
  if (!UUID_RE.test(journeyId)) return res.status(404).json({ error: 'journey_not_found' });
  const rows = await req.dbTx(async client => {
    const db = (sql, params) => client.query(sql, params);
    const access = await lockJourneyAndRoles(db, req.user.org_id, journeyId, req.user);
    if (access.error) return access;
    const result = await db(
      'SELECT e.id,e.category,e.file_name,e.mime_type,e.size_bytes,e.status,e.sha256,' +
      'e.captured_at,e.capture_time_quality,e.location_lat,e.location_lng,' +
      'e.location_accuracy_m,e.location_source,e.access_classification,' +
      'e.retention_policy,e.retention_until,e.created_by,e.device_id,e.created_at,' +
      'e.uploaded_at,e.verified_at,u.name AS captured_by_name ' +
      'FROM sjm_evidence e LEFT JOIN users u ON u.id=e.created_by AND u.org_id=e.org_id AND u.deleted_at IS NULL ' +
      'WHERE e.org_id=$1 AND e.journey_id=$2 AND e.deleted_at IS NULL ' +
      'AND ($3::boolean OR e.access_classification<>' + "'HIGHLY_SENSITIVE'" + ') ' +
      'ORDER BY e.created_at DESC,e.id DESC LIMIT 200',
      [req.user.org_id, journeyId, isManager(req.user)],
    );
    return { data: result.rows };
  });
  if (accessError(res, rows)) return;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: rows.data });
}));

router.post('/upload-url', asyncHandler(async (req, res) => {
  const journeyId = String(req.params.id || '');
  if (!UUID_RE.test(journeyId)) return res.status(404).json({ error: 'journey_not_found' });
  const normalized = normalizeUploadInput(req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error, max_bytes: normalized.max_bytes });
  const value = normalized.value;
  const evidenceId = crypto.randomUUID();
  const extension = value.mimeType === 'image/jpeg' ? 'jpg'
    : value.mimeType === 'image/png' ? 'png'
      : value.mimeType === 'video/mp4' ? 'mp4' : 'pdf';
  const storageKey = 'orgs/' + req.user.org_id + '/sjm/' + journeyId + '/evidence/' + evidenceId + '.' + extension;

  let outcome;
  try {
    outcome = await req.dbTx(async client => {
      const db = (sql, params) => client.query(sql, params);
      const access = await lockJourneyAndRoles(db, req.user.org_id, journeyId, req.user, 'FOR UPDATE');
      if (access.error) return access;
      if (TERMINAL.has(String(access.journey.status))) return { error: 'journey_terminal' };
      if (!canUploadEvidence(req.user, access.roles)) return { error: 'evidence_not_uploadable' };

      const signed = await storage.createUploadUrl({
        key: storageKey,
        mimeType: value.mimeType,
        evidenceId,
        journeyId,
      });
      await db(
        'INSERT INTO sjm_evidence ' +
        '(id,org_id,journey_id,category,file_name,mime_type,size_bytes,storage_key,status,' +
        'captured_at,capture_time_quality,location_lat,location_lng,location_accuracy_m,' +
        'location_source,access_classification,created_by,device_id) ' +
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'UPLOAD_PENDING',$9,$10,$11,$12,$13,$14,'INTERNAL_OPERATIONS',$15,$16)",
        [
          evidenceId, req.user.org_id, journeyId, value.category, value.fileName,
          value.mimeType, value.sizeBytes, storageKey, value.capturedAt,
          value.captureTimeQuality, value.location.lat, value.location.lng,
          value.location.accuracyM, value.location.source, req.user.id, value.deviceId,
        ],
      );
      await db(
        'INSERT INTO sjm_evidence_events (org_id,journey_id,evidence_id,actor_id,action,detail) ' +
        "VALUES ($1,$2,$3,$4,'UPLOAD_REQUESTED',$5)",
        [req.user.org_id, journeyId, evidenceId, req.user.id, JSON.stringify({
          category: value.category,
          mime_type: value.mimeType,
          size_bytes: value.sizeBytes,
          capture_time_quality: value.captureTimeQuality,
          location_source: value.location.source,
          device_id: value.deviceId,
        })],
      );
      return { data: { id: evidenceId, status: 'UPLOAD_PENDING', ...signed } };
    });
  } catch (error) {
    if (error?.code === 'storage_not_configured') {
      return res.status(503).json({ error: 'evidence_storage_unavailable', message: 'Private evidence storage is not configured.' });
    }
    throw error;
  }
  if (accessError(res, outcome)) return;
  res.setHeader('Cache-Control', 'no-store');
  res.status(201).json({ data: outcome.data });
}));

router.post('/:evidenceId/renew-upload-url', asyncHandler(async (req, res) => {
  const journeyId = String(req.params.id || ''), evidenceId = String(req.params.evidenceId || '');
  if (!UUID_RE.test(journeyId) || !UUID_RE.test(evidenceId)) return res.status(404).json({ error: 'evidence_not_found' });
  let result;
  try {
    result = await req.dbTx(async client => {
      const db = (sql, params) => client.query(sql, params);
      const access = await lockJourneyAndRoles(db, req.user.org_id, journeyId, req.user, 'FOR UPDATE');
      if (access.error) return access;
      if (TERMINAL.has(String(access.journey.status))) return { error: 'journey_terminal' };
      if (!canUploadEvidence(req.user, access.roles)) return { error: 'evidence_not_uploadable' };
      const selected = await db(
        'SELECT id,storage_key,mime_type,status FROM sjm_evidence ' +
        'WHERE id=$1 AND org_id=$2 AND journey_id=$3 AND deleted_at IS NULL FOR UPDATE',
        [evidenceId, req.user.org_id, journeyId],
      );
      const evidence = selected.rows[0];
      if (!evidence) return { error: 'evidence_not_found' };
      if (evidence.status !== 'UPLOAD_PENDING') return { error: 'evidence_not_verified' };
      const signed = await storage.createUploadUrl({
        key: evidence.storage_key, mimeType: evidence.mime_type, evidenceId, journeyId,
      });
      await db(
        'INSERT INTO sjm_evidence_events (org_id,journey_id,evidence_id,actor_id,action,detail) ' +
        "VALUES ($1,$2,$3,$4,'UPLOAD_REQUESTED',$5)",
        [req.user.org_id, journeyId, evidenceId, req.user.id, JSON.stringify({ renewal: true })],
      );
      return { data: { id: evidenceId, status: 'UPLOAD_PENDING', ...signed } };
    });
  } catch (error) {
    if (error?.code === 'storage_not_configured' || error?.code === 'storage_unavailable') {
      return res.status(503).json({ error: 'evidence_storage_unavailable' });
    }
    throw error;
  }
  if (accessError(res, result)) return;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: result.data });
}));

router.post('/:evidenceId/commit', asyncHandler(async (req, res) => {
  const journeyId = String(req.params.id || ''), evidenceId = String(req.params.evidenceId || '');
  if (!UUID_RE.test(journeyId) || !UUID_RE.test(evidenceId)) return res.status(404).json({ error: 'evidence_not_found' });

  const initial = await req.dbTx(async client => {
    const db = (sql, params) => client.query(sql, params);
    const access = await lockJourneyAndRoles(db, req.user.org_id, journeyId, req.user, 'FOR UPDATE');
    if (access.error) return access;
    const result = await db(
      'SELECT id,status,storage_key,mime_type,size_bytes,category,file_name,created_by,sha256 ' +
      'FROM sjm_evidence WHERE id=$1 AND org_id=$2 AND journey_id=$3 AND deleted_at IS NULL FOR UPDATE',
      [evidenceId, req.user.org_id, journeyId],
    );
    const evidence = result.rows[0];
    if (!evidence) return { error: 'evidence_not_found' };
    if (evidence.status === 'VERIFIED') return { verified: evidence };
    if (evidence.status !== 'UPLOAD_PENDING') return { error: 'evidence_not_verified' };
    if (!canUploadEvidence(req.user, access.roles)) return { error: 'evidence_not_uploadable' };
    return { evidence };
  });
  if (accessError(res, initial)) return;
  if (initial.verified) return res.json({ data: { id: evidenceId, status: 'VERIFIED', sha256: initial.verified.sha256, already_verified: true } });

  let integrity;
  try {
    integrity = await storage.verifyUploadedObject({
      key: initial.evidence.storage_key,
      mimeType: initial.evidence.mime_type,
      sizeBytes: Number(initial.evidence.size_bytes),
      evidenceId,
      journeyId,
    });
  } catch (error) {
    if (error?.code === 'object_not_found') {
      return res.status(409).json({ error: 'evidence_upload_missing', message: 'The file has not reached private storage. Upload it before committing.' });
    }
    if (error?.code === 'size_mismatch' || error?.code === 'mime_mismatch' || error?.code === 'metadata_mismatch' || error?.code === 'content_signature_mismatch') {
      const rejected = await req.dbTx(async client => {
        const db = (sql, params) => client.query(sql, params);
        const access = await lockJourneyAndRoles(db, req.user.org_id, journeyId, req.user, 'FOR UPDATE');
        if (access.error) return access;
        if (!canUploadEvidence(req.user, access.roles)) return { error: 'evidence_not_uploadable' };
        const current = await db(
          'SELECT id,status FROM sjm_evidence WHERE id=$1 AND org_id=$2 AND journey_id=$3 FOR UPDATE',
          [evidenceId, req.user.org_id, journeyId],
        );
        if (current.rows[0]?.status !== 'UPLOAD_PENDING') return { error: 'evidence_not_verified' };
        await db(
          "UPDATE sjm_evidence SET status='REJECTED',updated_at=NOW() WHERE id=$1 AND org_id=$2",
          [evidenceId, req.user.org_id],
        );
        await db(
          'INSERT INTO sjm_evidence_events (org_id,journey_id,evidence_id,actor_id,action,detail) ' +
          "VALUES ($1,$2,$3,$4,'UPLOAD_REJECTED',$5)",
          [req.user.org_id, journeyId, evidenceId, req.user.id, JSON.stringify({ reason: error.code })],
        );
        return { rejected: true };
      });
      if (accessError(res, rejected)) return;
      return res.status(422).json({ error: 'evidence_integrity_rejected', message: 'The stored object failed type, size or identity verification. It remains unavailable for download.' });
    }
    if (error?.code === 'storage_not_configured' || error?.code === 'storage_unavailable') {
      return res.status(503).json({ error: 'evidence_storage_unavailable', message: 'Private evidence storage could not complete verification. The evidence remains pending.' });
    }
    throw error;
  }

  const completed = await req.dbTx(async client => {
    const db = (sql, params) => client.query(sql, params);
    const access = await lockJourneyAndRoles(db, req.user.org_id, journeyId, req.user, 'FOR UPDATE');
    if (access.error) return access;
    if (TERMINAL.has(String(access.journey.status))) return { error: 'journey_terminal' };
    if (!canUploadEvidence(req.user, access.roles)) return { error: 'evidence_not_uploadable' };
    const current = await db(
      'SELECT id,status,sha256 FROM sjm_evidence ' +
      'WHERE id=$1 AND org_id=$2 AND journey_id=$3 AND deleted_at IS NULL FOR UPDATE',
      [evidenceId, req.user.org_id, journeyId],
    );
    const row = current.rows[0];
    if (!row) return { error: 'evidence_not_found' };
    if (row.status === 'VERIFIED') return { data: row, already_verified: true };
    if (row.status !== 'UPLOAD_PENDING') return { error: 'evidence_not_verified' };
    const updated = await db(
      "UPDATE sjm_evidence SET status='VERIFIED',sha256=$1,uploaded_at=NOW(),verified_at=NOW(),updated_at=NOW() " +
      "WHERE id=$2 AND org_id=$3 AND journey_id=$4 AND status='UPLOAD_PENDING' " +
      'RETURNING id,status,sha256,size_bytes,mime_type,uploaded_at,verified_at',
      [integrity.sha256, evidenceId, req.user.org_id, journeyId],
    );
    if (!updated.rows.length) return { error: 'evidence_not_verified' };
    await db(
      'INSERT INTO sjm_evidence_events (org_id,journey_id,evidence_id,actor_id,action,detail) ' +
      "VALUES ($1,$2,$3,$4,'UPLOAD_VERIFIED',$5)",
      [req.user.org_id, journeyId, evidenceId, req.user.id, JSON.stringify({
        sha256: integrity.sha256,
        size_bytes: integrity.size_bytes,
        mime_type: integrity.content_type,
      })],
    );
    return { data: updated.rows[0], already_verified: false };
  });
  if (accessError(res, completed)) return;
  res.status(200).json({ data: completed.data });
}));

router.post('/:evidenceId/download-url', asyncHandler(async (req, res) => {
  const journeyId = String(req.params.id || ''), evidenceId = String(req.params.evidenceId || '');
  if (!UUID_RE.test(journeyId) || !UUID_RE.test(evidenceId)) return res.status(404).json({ error: 'evidence_not_found' });
  const selected = await req.dbTx(async client => {
    const db = (sql, params) => client.query(sql, params);
    const access = await lockJourneyAndRoles(db, req.user.org_id, journeyId, req.user);
    if (access.error) return access;
    const result = await db(
      'SELECT id,storage_key,mime_type,file_name,status,access_classification FROM sjm_evidence ' +
      'WHERE id=$1 AND org_id=$2 AND journey_id=$3 AND deleted_at IS NULL LIMIT 1',
      [evidenceId, req.user.org_id, journeyId],
    );
    const evidence = result.rows[0];
    if (!evidence) return { error: 'evidence_not_found' };
    // Travel identity documents are never exposed to field-duty accounts.
    if (!canViewEvidence(req.user, evidence)) return { error: 'evidence_not_found' };
    if (evidence.status !== 'VERIFIED') return { error: 'evidence_not_verified' };
    return { evidence };
  });
  if (accessError(res, selected)) return;

  let signed;
  try {
    signed = await storage.createDownloadUrl({
      key: selected.evidence.storage_key,
      mimeType: selected.evidence.mime_type,
      fileName: selected.evidence.file_name,
    });
  } catch (error) {
    if (error?.code === 'storage_not_configured' || error?.code === 'storage_unavailable') {
      return res.status(503).json({ error: 'evidence_storage_unavailable' });
    }
    throw error;
  }

  const logged = await req.dbTx(async client => {
    const db = (sql, params) => client.query(sql, params);
    const access = await lockJourneyAndRoles(db, req.user.org_id, journeyId, req.user);
    if (access.error) return access;
    const current = await db(
      'SELECT id,status FROM sjm_evidence WHERE id=$1 AND org_id=$2 AND journey_id=$3 AND deleted_at IS NULL FOR SHARE',
      [evidenceId, req.user.org_id, journeyId],
    );
    if (!current.rows.length) return { error: 'evidence_not_found' };
    if (current.rows[0].status !== 'VERIFIED') return { error: 'evidence_not_verified' };
    await db(
      'INSERT INTO sjm_evidence_events (org_id,journey_id,evidence_id,actor_id,action,detail) ' +
      "VALUES ($1,$2,$3,$4,'DOWNLOAD_URL_ISSUED',$5)",
      [req.user.org_id, journeyId, evidenceId, req.user.id, JSON.stringify({ expires_at: signed.expires_at })],
    );
    return { ok: true };
  });
  if (accessError(res, logged)) return;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: signed });
}));

module.exports = router;
module.exports.__test = {
  normalizeUploadInput,
  canUploadEvidence,
  canViewEvidence,
  CATEGORY_MIME_TYPES,
  MAX_BYTES,
};
