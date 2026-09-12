/**
 * S2-F7: Voice Notes
 * Storage: presigned S3/GCS upload URL approach (org controls storage bucket)
 */
const router = require('express').Router();
const Joi = require('joi');
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const crypto = require('crypto');

router.use(authenticate, attachOrgDb);

const PARENT_TYPES = ['shift_handover', 'incident', 'convoy', 'claim'];

// POST /voice-notes/upload-url — get presigned upload URL
router.post('/upload-url', asyncHandler(async (req, res) => {
  const schema = Joi.object({
    parent_type: Joi.string().valid(...PARENT_TYPES).required(),
    parent_id: Joi.string().uuid().required(),
    mime_type: Joi.string().default('audio/webm'),
    duration_sec: Joi.number().integer().positive(),
    file_size_bytes: Joi.number().integer().positive(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const orgId = req.user.org_id;
  const noteId = crypto.randomUUID();
  const ext = value.mime_type.includes('webm') ? 'webm' : value.mime_type.includes('mp4') ? 'mp4' : 'ogg';
  const storageKey = `voice-notes/${orgId}/${value.parent_type}/${value.parent_id}/${noteId}.${ext}`;

  // Generate presigned URL if AWS configured, otherwise return placeholder
  let uploadUrl = null;
  try {
    const bucket = process.env.S3_BUCKET;
    const region = process.env.AWS_REGION || 'us-east-1';
    if (bucket && process.env.AWS_ACCESS_KEY_ID) {
      const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
      const s3 = new S3Client({ region });
      const cmd = new PutObjectCommand({ Bucket: bucket, Key: storageKey, ContentType: value.mime_type });
      uploadUrl = await getSignedUrl(s3, cmd, { expiresIn: 300 });
    }
  } catch (_) {}

  res.json({
    note_id: noteId,
    storage_key: storageKey,
    upload_url: uploadUrl,
    expires_in: 300,
  });
}));

// POST /voice-notes/commit — record after successful upload
router.post('/commit', asyncHandler(async (req, res) => {
  const schema = Joi.object({
    note_id: Joi.string().uuid().required(),
    parent_type: Joi.string().valid(...PARENT_TYPES).required(),
    parent_id: Joi.string().uuid().required(),
    storage_key: Joi.string().max(500).required(),
    duration_sec: Joi.number().integer().positive(),
    file_size_bytes: Joi.number().integer().positive(),
    mime_type: Joi.string().default('audio/webm'),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const result = await req.db(
    `INSERT INTO voice_notes
       (id, org_id, parent_type, parent_id, uploaded_by, storage_key, duration_sec, file_size_bytes, mime_type)
     VALUES ($1, (current_setting('app.current_org_id',true))::uuid, $2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
    [value.note_id, value.parent_type, value.parent_id, req.user.id,
     value.storage_key, value.duration_sec || null, value.file_size_bytes || null, value.mime_type],
  );
  res.status(201).json({ data: result.rows[0] ?? { id: value.note_id } });
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

  // Generate presigned download URLs
  const notes = await Promise.all(result.rows.map(async (note) => {
    let downloadUrl = null;
    try {
      const bucket = process.env.S3_BUCKET;
      const region = process.env.AWS_REGION || 'us-east-1';
      if (bucket && process.env.AWS_ACCESS_KEY_ID) {
        const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
        const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
        const s3 = new S3Client({ region });
        const cmd = new GetObjectCommand({ Bucket: bucket, Key: note.storage_key });
        downloadUrl = await getSignedUrl(s3, cmd, { expiresIn: 900 });
      }
    } catch (_) {}
    return { ...note, download_url: downloadUrl };
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
