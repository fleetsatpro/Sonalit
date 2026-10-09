/**
 * S2-F7: Voice Notes
 * Storage: signed Cloudflare R2 object uploads, confirmed before metadata commit.
 */
const router = require('express').Router();
const Joi = require('joi');
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const crypto = require('crypto');

router.use(authenticate, attachOrgDb);

const PARENT_TYPES = ['shift_handover', 'incident', 'convoy', 'claim'];
const AUDIO_MIME_TYPES = new Set([
  'audio/webm', 'audio/ogg', 'audio/mp4',
  'audio/webm;codecs=opus', 'audio/ogg;codecs=opus',
]);

function objectExtension(mimeType) {
  const type = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (type === 'audio/webm') return 'webm';
  if (type === 'audio/mp4') return 'mp4';
  if (type === 'audio/ogg') return 'ogg';
  return null;
}

function createR2Client() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_BUCKET) return null;
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
  });
}

function validExistingCommit(row, value, req, storageKey) {
  return row &&
    row.id === value.note_id &&
    row.org_id === req.user.org_id &&
    row.parent_type === value.parent_type &&
    row.parent_id === value.parent_id &&
    row.storage_key === storageKey &&
    row.uploaded_by === req.user.id &&
    Number(row.file_size_bytes || 0) === Number(value.file_size_bytes || 0) &&
    String(row.mime_type || '') === String(value.mime_type || '');
}

// POST /voice-notes/upload-url — get presigned upload URL
router.post('/upload-url', asyncHandler(async (req, res) => {
  const schema = Joi.object({
    note_id: Joi.string().uuid().optional(),
    parent_type: Joi.string().valid(...PARENT_TYPES).required(),
    parent_id: Joi.string().uuid().required(),
    mime_type: Joi.string().valid(...AUDIO_MIME_TYPES).default('audio/webm'),
    duration_sec: Joi.number().integer().min(1).max(60).required(),
    file_size_bytes: Joi.number().integer().min(1).max(25 * 1024 * 1024).required(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const orgId = req.user.org_id;
  const noteId = value.note_id || crypto.randomUUID();
  const ext = objectExtension(value.mime_type);
  if (!ext) return res.status(415).json({ error: 'unsupported_audio_type' });
  const storageKey = `voice-notes/${orgId}/${value.parent_type}/${value.parent_id}/${noteId}.${ext}`;

  const s3 = createR2Client();
  if (!s3) return res.status(503).json({ error: 'storage_not_configured' });
  try {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const cmd = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: storageKey,
      ContentType: value.mime_type,
    });
    const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 300 });
    if (typeof uploadUrl !== 'string' || !uploadUrl.startsWith('https://')) {
      return res.status(503).json({ error: 'storage_signing_failed' });
    }
    return res.json({
      note_id: noteId,
      storage_key: storageKey,
      upload_url: uploadUrl,
      expires_in: 300,
    });
  } catch (_) {
    // Do not return or log signed URLs, credentials, or upstream exception text.
    return res.status(503).json({ error: 'storage_signing_failed' });
  }
}));

// POST /voice-notes/commit — record after successful upload
router.post('/commit', asyncHandler(async (req, res) => {
  const schema = Joi.object({
    note_id: Joi.string().uuid().required(),
    parent_type: Joi.string().valid(...PARENT_TYPES).required(),
    parent_id: Joi.string().uuid().required(),
    storage_key: Joi.string().max(500).required(),
    duration_sec: Joi.number().integer().min(1).max(60).required(),
    file_size_bytes: Joi.number().integer().min(1).max(25 * 1024 * 1024).required(),
    mime_type: Joi.string().valid(...AUDIO_MIME_TYPES).default('audio/webm'),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const orgId = req.user.org_id;
  const ext = objectExtension(value.mime_type);
  if (!ext) return res.status(415).json({ error: 'unsupported_audio_type' });
  const expectedKey = `voice-notes/${orgId}/${value.parent_type}/${value.parent_id}/${value.note_id}.${ext}`;
  if (value.storage_key !== expectedKey) {
    return res.status(422).json({ error: 'storage_key_not_in_tenant_namespace' });
  }

  const s3 = createR2Client();
  if (!s3) return res.status(503).json({ error: 'storage_not_configured' });
  try {
    const { HeadObjectCommand } = require('@aws-sdk/client-s3');
    const head = await s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: expectedKey }));
    if (head?.ContentLength == null || !Number.isFinite(Number(head.ContentLength)) ||
        Number(head.ContentLength) !== Number(value.file_size_bytes)) {
      return res.status(422).json({ error: 'uploaded_object_size_mismatch' });
    }
    const actualMime = String(head?.ContentType || '').split(';')[0].trim().toLowerCase();
    const expectedMime = String(value.mime_type).split(';')[0].trim().toLowerCase();
    if (!actualMime || actualMime !== expectedMime) {
      return res.status(422).json({ error: 'uploaded_object_type_mismatch' });
    }
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode || err?.statusCode;
    const code = String(err?.name || err?.Code || '');
    if (status === 404 || code === 'NotFound' || code === 'NoSuchKey') {
      return res.status(409).json({ error: 'uploaded_object_not_found' });
    }
    return res.status(503).json({ error: 'storage_verification_failed' });
  }

  const result = await req.db(
    `INSERT INTO voice_notes
       (id, org_id, parent_type, parent_id, uploaded_by, storage_key, duration_sec, file_size_bytes, mime_type)
     VALUES ($1, (current_setting('app.current_org_id',true))::uuid, $2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
    [value.note_id, value.parent_type, value.parent_id, req.user.id,
     expectedKey, value.duration_sec, value.file_size_bytes, value.mime_type],
  );

  if (result.rows[0]) return res.status(201).json({ data: result.rows[0], duplicate: false });

  // A lost commit acknowledgement is retryable; a duplicate ID with different
  // tenant/parent/payload is not. RLS hides rows belonging to another tenant.
  const existing = await req.db(
    `SELECT id, org_id, parent_type, parent_id, uploaded_by, storage_key, file_size_bytes, mime_type
       FROM voice_notes WHERE id=$1 AND org_id=$2 AND deleted_at IS NULL LIMIT 1`,
    [value.note_id, orgId],
  );
  if (validExistingCommit(existing.rows?.[0], value, req, expectedKey)) {
    return res.status(200).json({ data: existing.rows[0], duplicate: true });
  }
  return res.status(409).json({ error: 'voice_note_id_conflict' });
}));

// GET /voice-notes/:parentType/:parentId
router.get('/:parentType/:parentId', asyncHandler(async (req, res) => {
  if (!PARENT_TYPES.includes(req.params.parentType)) {
    return res.status(400).json({ error: `Invalid parent_type. Must be: ${PARENT_TYPES.join(', ')}` });
  }
  const result = await req.db(
    `SELECT vn.*, u.name AS uploader_name
       FROM voice_notes vn
       LEFT JOIN users u ON u.id = vn.uploaded_by
      WHERE vn.parent_type = $1 AND vn.parent_id = $2 AND vn.deleted_at IS NULL
      ORDER BY vn.created_at ASC`,
    [req.params.parentType, req.params.parentId],
  );

  // Download URLs use the same canonical Sonalit R2 account as uploads.
  const s3 = createR2Client();
  const notes = await Promise.all(result.rows.map(async (note) => {
    // Do not sign a historical or corrupted key outside this tenant's exact
    // namespace, even if its metadata row is visible through an older schema.
    if (typeof note.storage_key !== 'string' || !note.storage_key.startsWith(`voice-notes/${req.user.org_id}/`)) {
      return { ...note, download_url: null, download_available: false, storage_error: 'storage_key_not_in_tenant_namespace' };
    }
    if (!s3) return { ...note, download_url: null, download_available: false, storage_error: 'storage_not_configured' };
    try {
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
      const cmd = new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: note.storage_key });
      const downloadUrl = await getSignedUrl(s3, cmd, { expiresIn: 900 });
      return { ...note, download_url: downloadUrl, download_available: true, storage_error: null };
    } catch (_) {
      return { ...note, download_url: null, download_available: false, storage_error: 'storage_signing_failed' };
    }
  }));

  res.json({ data: notes });
}));

// DELETE /voice-notes/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  await req.db(
    `UPDATE voice_notes SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [req.params.id],
  );
  res.json({ ok: true });
}));

module.exports = router;
