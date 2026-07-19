/**
 * S2-F5: Insurance Claim Builder
 * RULE D: POST /claims requires X-Idempotency-Key
 */
const router = require('express').Router();
const Joi = require('joi');
const PDFDocument = require('pdfkit');
const { authenticate } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const { auditLog } = require('../middleware/audit');
const logger = require('../utils/logger');

router.use(authenticate, attachOrgDb);

// ─── Claim PDF rendering + storage ────────────────────────────────────────────

/** Renders an insurance claim to a PDF buffer with pdfkit (buffered in memory —
 *  claims are a page or two, no need to spill to disk). */
function renderClaimPdf(claim) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const money = claim.estimated_value != null
      ? `${claim.currency || ''} ${Number(claim.estimated_value).toLocaleString()}`.trim()
      : '—';
    const line = (label, value) => {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#444').text(label);
      doc.font('Helvetica').fontSize(11).fillColor('#000').text(value != null && value !== '' ? String(value) : '—');
      doc.moveDown(0.6);
    };

    doc.font('Helvetica-Bold').fontSize(18).text('Insurance Claim', { align: 'left' });
    doc.font('Helvetica').fontSize(10).fillColor('#666')
      .text(`Claim ${claim.claim_number || claim.id}`)
      .text(`Status: ${claim.status || 'draft'}`)
      .text(`Generated: ${new Date().toISOString()}`);
    doc.moveDown(1).fillColor('#000');

    line('Insurer', claim.insurer_name);
    line('Policy number', claim.policy_number);
    line('Incident date', claim.incident_date);
    line('Incident location', claim.incident_location);
    line('Incident description', claim.incident_description);
    line('Damage description', claim.damage_description);
    line('Estimated value', money);
    line('Police reference', claim.police_ref);
    line('Witnesses', claim.witness_names);
    if (claim.resolution_note) line('Resolution note', claim.resolution_note);

    doc.end();
  });
}

/** Server-side R2 upload (mirrors convoyReportWorker). Returns the public URL,
 *  or null when object storage isn't configured on this server. */
async function uploadPdfToR2(key, buffer) {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, R2_PUBLIC_URL } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_BUCKET || !R2_PUBLIC_URL) return null;
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
  });
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: buffer, ContentType: 'application/pdf', CacheControl: 'no-store',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

const VALID_STATUSES = ['draft', 'submitted', 'under_review', 'approved', 'rejected', 'withdrawn'];
const STATUS_TRANSITIONS = {
  draft: ['submitted', 'withdrawn'],
  submitted: ['under_review', 'withdrawn'],
  under_review: ['approved', 'rejected'],
  approved: [],
  rejected: [],
  withdrawn: [],
};

const claimSchema = Joi.object({
  incident_id: Joi.string().uuid(),
  convoy_id: Joi.string().uuid(),
  vehicle_id: Joi.string().uuid(),
  driver_id: Joi.string().uuid(),
  claim_number: Joi.string().max(100),
  insurer_name: Joi.string().max(200),
  policy_number: Joi.string().max(100),
  incident_date: Joi.string().isoDate(),
  incident_location: Joi.string().max(500),
  incident_description: Joi.string().max(5000),
  damage_description: Joi.string().max(5000),
  estimated_value: Joi.number().positive(),
  currency: Joi.string().length(3).default('KES'),
  police_ref: Joi.string().max(100),
  witness_names: Joi.string().max(2000),
});

// GET /claims
router.get('/claims', asyncHandler(async (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit) || 50);
  const status = req.query.status;
  const filters = [];
  const params = [];
  if (status) { params.push(status); filters.push(`c.status = $${params.length}`); }
  params.push(limit);
  const where = filters.length ? `AND ${filters.join(' AND ')}` : '';
  const result = await req.db(
    `SELECT c.*, i.title AS incident_title, v.registration AS vehicle_reg
       FROM insurance_claims c
       LEFT JOIN incidents i ON i.id = c.incident_id
       LEFT JOIN vehicles v ON v.id = c.vehicle_id
      WHERE TRUE ${where}
      ORDER BY c.created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  res.json({ data: result.rows });
}));

// POST /claims
router.post('/claims', auditLog('insurance_claims'), asyncHandler(async (req, res) => {
  const idempotencyKey = req.headers['x-idempotency-key'];
  if (!idempotencyKey) return res.status(400).json({ error: 'X-Idempotency-Key header required' });

  const { error, value } = claimSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const result = await req.db(
    `INSERT INTO insurance_claims
       (org_id, incident_id, convoy_id, vehicle_id, driver_id, claim_number, insurer_name,
        policy_number, incident_date, incident_location, incident_description, damage_description,
        estimated_value, currency, police_ref, witness_names, created_by, updated_by)
     VALUES ((current_setting('app.current_org_id',true))::uuid,
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
     RETURNING *`,
    [value.incident_id || null, value.convoy_id || null, value.vehicle_id || null,
     value.driver_id || null, value.claim_number || null, value.insurer_name || null,
     value.policy_number || null, value.incident_date || null, value.incident_location || null,
     value.incident_description || null, value.damage_description || null,
     value.estimated_value || null, value.currency, value.police_ref || null,
     value.witness_names || null, req.user.id],
  );
  req.auditAction = 'CREATE';
  req.auditRecordId = result.rows[0].id;
  req.auditAfter = result.rows[0];
  res.status(201).json({ data: result.rows[0] });
}));

// PUT /claims/:id
router.put('/claims/:id', auditLog('insurance_claims'), asyncHandler(async (req, res) => {
  const { error, value } = claimSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const result = await req.db(
    `UPDATE insurance_claims
        SET incident_id          = COALESCE($1, incident_id),
            convoy_id            = COALESCE($2, convoy_id),
            vehicle_id           = COALESCE($3, vehicle_id),
            insurer_name         = COALESCE($4, insurer_name),
            policy_number        = COALESCE($5, policy_number),
            incident_date        = COALESCE($6, incident_date),
            incident_location    = COALESCE($7, incident_location),
            incident_description = COALESCE($8, incident_description),
            damage_description   = COALESCE($9, damage_description),
            estimated_value      = COALESCE($10, estimated_value),
            police_ref           = COALESCE($11, police_ref),
            witness_names        = COALESCE($12, witness_names),
            updated_by           = $13,
            updated_at           = NOW()
      WHERE id = $14 AND status = 'draft'
      RETURNING *`,
    [value.incident_id || null, value.convoy_id || null, value.vehicle_id || null,
     value.insurer_name || null, value.policy_number || null, value.incident_date || null,
     value.incident_location || null, value.incident_description || null, value.damage_description || null,
     value.estimated_value || null, value.police_ref || null, value.witness_names || null,
     req.user.id, req.params.id],
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Claim not found or not editable' });
  req.auditAction = 'UPDATE';
  req.auditRecordId = result.rows[0].id;
  req.auditAfter = result.rows[0];
  res.json({ data: result.rows[0] });
}));

// PATCH /claims/:id/status — state machine
router.patch('/claims/:id/status', auditLog('insurance_claims'), asyncHandler(async (req, res) => {
  const { status, resolution_note } = req.body;
  if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });

  const current = await req.db(`SELECT status FROM insurance_claims WHERE id = $1`, [req.params.id]);
  if (!current.rows.length) return res.status(404).json({ error: 'Claim not found' });

  const allowed = STATUS_TRANSITIONS[current.rows[0].status] ?? [];
  if (!allowed.includes(status)) {
    return res.status(422).json({ error: `Cannot transition from '${current.rows[0].status}' to '${status}'` });
  }

  const timestampCols = {
    submitted: 'submitted_at = NOW(),',
    under_review: 'reviewed_at = NOW(),',
    approved: 'resolved_at = NOW(),',
    rejected: 'resolved_at = NOW(),',
  };

  const result = await req.db(
    `UPDATE insurance_claims
        SET status = $1,
            ${timestampCols[status] ?? ''}
            resolution_note = COALESCE($2, resolution_note),
            updated_by = $3,
            updated_at = NOW()
      WHERE id = $4 RETURNING *`,
    [status, resolution_note || null, req.user.id, req.params.id],
  );
  req.auditAction = 'UPDATE';
  req.auditRecordId = result.rows[0].id;
  req.auditAfter = result.rows[0];
  res.json({ data: result.rows[0] });
}));

// POST /claims/:id/generate-pdf — render the claim to a PDF, store it in R2, and
// record the URL. Previously a stub that only stamped pdf_generated_at.
router.post('/claims/:id/generate-pdf', auditLog('insurance_claims'), asyncHandler(async (req, res) => {
  const claimRes = await req.db(`SELECT * FROM insurance_claims WHERE id = $1`, [req.params.id]);
  if (!claimRes.rows.length) return res.status(404).json({ error: 'Claim not found' });
  const claim = claimRes.rows[0];

  let buffer;
  try {
    buffer = await renderClaimPdf(claim);
  } catch (err) {
    logger.error(`Claim PDF render failed for ${claim.id}: ${err.message}`);
    return res.status(500).json({ error: 'Failed to render claim PDF' });
  }

  const key = `claims/${claim.org_id || 'default'}/${claim.id}.pdf`;
  const url = await uploadPdfToR2(key, buffer);
  if (!url) {
    return res.status(501).json({ error: 'PDF storage (R2) not configured on this server' });
  }

  await req.db(
    `UPDATE insurance_claims SET pdf_url = $1, pdf_generated_at = NOW(), updated_at = NOW() WHERE id = $2`,
    [url, req.params.id],
  );

  req.auditAction = 'UPDATE';
  req.auditRecordId = req.params.id;
  res.json({ ok: true, pdf_url: url, claim_id: req.params.id });
}));

// GET /claims/:id/download — redirect to PDF URL
router.get('/claims/:id/download', asyncHandler(async (req, res) => {
  const result = await req.db(`SELECT pdf_url FROM insurance_claims WHERE id = $1`, [req.params.id]);
  if (!result.rows.length) return res.status(404).json({ error: 'Claim not found' });
  if (!result.rows[0].pdf_url) return res.status(404).json({ error: 'PDF not yet generated' });
  res.redirect(result.rows[0].pdf_url);
}));

// GET /incidents/:id/claims — claims for an incident
router.get('/incidents/:incidentId/claims', asyncHandler(async (req, res) => {
  const result = await req.db(
    `SELECT * FROM insurance_claims WHERE incident_id = $1 ORDER BY created_at DESC`,
    [req.params.incidentId],
  );
  res.json({ data: result.rows });
}));

module.exports = router;
