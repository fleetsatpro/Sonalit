/**
 * Handover Officer routes — mounted at /api/v1/convoy-handovers
 *
 * Most convoys are signed over by a dedicated handover_officer through these
 * routes: they list convoys currently in 'completing' status, pick a convoy
 * (or one of its trucks, for convoys handed over truck-by-truck), and upload
 * the signed handover form. A convoy created/marked as local_consignment is
 * deliberately excluded from this queue — its CFO handles the handover
 * themselves from the Guardian app (see guardianCfo.js's /handover routes).
 */
const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { authenticate, authorize } = require('../middleware/auth');
const { attachOrgDb } = require('../utils/orgScopedDb');
const { asyncHandler } = require('../middleware/error');
const { finalizeConvoyCompletion } = require('../controllers/convoyController');

router.use(authenticate, attachOrgDb);
router.use((req, res, next) => {
  if (!req.db) return res.status(403).json({ error: 'org_scope_required' });
  next();
});

const canHandover = authorize('admin', 'dispatcher', 'handover_officer');

// GET /convoy-handovers/queue — convoys awaiting handover from an officer
router.get('/queue', canHandover, asyncHandler(async (req, res) => {
  const result = await req.db(
    `SELECT c.id, c.name, c.region, c.route_origin, c.route_destination, c.status,
            (SELECT COUNT(*) FROM convoy_trucks ct WHERE ct.convoy_id = c.id) AS truck_count,
            (SELECT COUNT(*) FROM convoy_handovers ch
               WHERE ch.convoy_id = c.id AND ch.convoy_truck_id IS NOT NULL AND ch.deleted_at IS NULL) AS trucks_handed_over,
            EXISTS (SELECT 1 FROM convoy_handovers ch
               WHERE ch.convoy_id = c.id AND ch.convoy_truck_id IS NULL AND ch.deleted_at IS NULL) AS convoy_wide_handover
     FROM convoys c
     WHERE c.status = 'completing' AND c.local_consignment = false AND c.deleted_at IS NULL
     ORDER BY c.updated_at DESC`
  );
  res.json({ data: result.rows });
}));

// GET /convoy-handovers/:convoyId — trucks + existing handover records, for the picker
router.get('/:convoyId', canHandover, asyncHandler(async (req, res) => {
  const convoyResult = await req.db(
    `SELECT id, name, region, route_origin, route_destination, status, local_consignment
     FROM convoys WHERE id = $1 AND deleted_at IS NULL`,
    [req.params.convoyId]
  );
  if (!convoyResult.rows.length) return res.status(404).json({ error: 'Convoy not found' });

  const [trucksResult, handoversResult] = await Promise.all([
    req.db(
      `SELECT ct.id, ct.position, COALESCE(ct.registration, v.registration) AS plate_number, ct.driver_name
       FROM convoy_trucks ct LEFT JOIN vehicles v ON v.id = ct.vehicle_id
       WHERE ct.convoy_id = $1 ORDER BY ct.position`,
      [req.params.convoyId]
    ),
    req.db(
      `SELECT id, convoy_truck_id, handed_over_by_role, form_url, notes, signed_off_at
       FROM convoy_handovers WHERE convoy_id = $1 AND deleted_at IS NULL`,
      [req.params.convoyId]
    ),
  ]);

  res.json({ data: { convoy: convoyResult.rows[0], trucks: trucksResult.rows, handovers: handoversResult.rows } });
}));

// POST /convoy-handovers/:convoyId/upload-url  { truck_id?, content_type }
// Returns a 5-minute presigned R2 PUT URL for the handover form (image or PDF)
// — same presign-then-PUT-direct-to-R2 pattern the rest of the app uses for
// uploads (see features/comms/components/Composer.tsx, guardianCfo.js).
router.post('/:convoyId/upload-url', canHandover, asyncHandler(async (req, res) => {
  const convoyId = req.params.convoyId;
  const { truck_id, content_type } = req.body;
  const isPdf = content_type === 'application/pdf';
  if (content_type && !isPdf && content_type !== 'image/jpeg') {
    return res.status(400).json({ error: 'content_type must be image/jpeg or application/pdf' });
  }

  const convoyResult = await req.db(
    `SELECT id, status, local_consignment FROM convoys WHERE id = $1 AND deleted_at IS NULL`,
    [convoyId]
  );
  if (!convoyResult.rows.length) return res.status(404).json({ error: 'Convoy not found' });
  const convoy = convoyResult.rows[0];
  if (convoy.local_consignment) {
    return res.status(403).json({ error: 'local_consignment', detail: 'This convoy hands over through its CFO, not a handover officer.' });
  }
  if (convoy.status !== 'completing') {
    return res.status(422).json({ error: 'convoy_not_completing', detail: 'This convoy is not awaiting handover.' });
  }
  if (truck_id) {
    const truckCheck = await req.db(`SELECT id FROM convoy_trucks WHERE id = $1 AND convoy_id = $2`, [truck_id, convoyId]);
    if (!truckCheck.rows.length) return res.status(404).json({ error: 'Truck not found on this convoy' });
  }

  const { R2_ACCOUNT_ID, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET, R2_PUBLIC_URL } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_BUCKET) {
    return res.status(501).json({ error: 'Storage not configured on this server' });
  }
  if (!R2_PUBLIC_URL) {
    return res.status(501).json({ error: 'Storage public URL (R2_PUBLIC_URL) not configured on this server' });
  }

  let S3Client, PutObjectCommand, getSignedUrl;
  try {
    ({ S3Client, PutObjectCommand } = require('@aws-sdk/client-s3'));
    ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));
  } catch {
    return res.status(501).json({ error: 'Storage SDK not installed' });
  }

  const ext = isPdf ? 'pdf' : 'jpg';
  const key = `handover-officer/${convoyId}/${truck_id || 'convoy'}/handover_${uuidv4()}.${ext}`;
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
  });
  const command = new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: isPdf ? 'application/pdf' : 'image/jpeg' });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

  res.json({ upload_url: uploadUrl, public_url: `${R2_PUBLIC_URL}/${key}`, key });
}));

// POST /convoy-handovers/:convoyId/commit  { truck_id?, form_key, form_url, notes? }
// Records the handover after the form has been PUT to R2, and completes the
// convoy immediately if this satisfies its handover requirement.
router.post('/:convoyId/commit', canHandover, asyncHandler(async (req, res) => {
  const convoyId = req.params.convoyId;
  const { truck_id, form_key, form_url, notes } = req.body;
  if (!form_key || !form_url) return res.status(400).json({ error: 'form_key, form_url required' });
  const truckId = typeof truck_id === 'string' && truck_id ? truck_id : null;

  const convoyResult = await req.db(
    `SELECT id, org_id, status, local_consignment FROM convoys WHERE id = $1 AND deleted_at IS NULL`,
    [convoyId]
  );
  if (!convoyResult.rows.length) return res.status(404).json({ error: 'Convoy not found' });
  const convoy = convoyResult.rows[0];
  if (convoy.local_consignment) {
    return res.status(403).json({ error: 'local_consignment', detail: 'This convoy hands over through its CFO, not a handover officer.' });
  }
  if (convoy.status !== 'completing') {
    return res.status(422).json({ error: 'convoy_not_completing', detail: 'This convoy is not awaiting handover.' });
  }
  if (truckId) {
    const truckCheck = await req.db(`SELECT id FROM convoy_trucks WHERE id = $1 AND convoy_id = $2`, [truckId, convoyId]);
    if (!truckCheck.rows.length) return res.status(404).json({ error: 'Truck not found on this convoy' });
  }

  const handoverResult = await req.db(
    truckId
      ? `INSERT INTO convoy_handovers
           (org_id, convoy_id, convoy_truck_id, handed_over_by_role, handed_over_by_user_id, form_key, form_url, notes)
         VALUES ($1,$2,$3,'handover_officer',$4,$5,$6,$7)
         ON CONFLICT (convoy_id, convoy_truck_id) WHERE convoy_truck_id IS NOT NULL AND deleted_at IS NULL
         DO UPDATE SET form_key = EXCLUDED.form_key, form_url = EXCLUDED.form_url,
           notes = EXCLUDED.notes, signed_off_at = NOW()
         RETURNING *`
      : `INSERT INTO convoy_handovers
           (org_id, convoy_id, convoy_truck_id, handed_over_by_role, handed_over_by_user_id, form_key, form_url, notes)
         VALUES ($1,$2,NULL,'handover_officer',$3,$4,$5,$6)
         ON CONFLICT (convoy_id) WHERE convoy_truck_id IS NULL AND deleted_at IS NULL
         DO UPDATE SET form_key = EXCLUDED.form_key, form_url = EXCLUDED.form_url,
           notes = EXCLUDED.notes, signed_off_at = NOW()
         RETURNING *`,
    truckId
      ? [convoy.org_id, convoyId, truckId, req.user.id, form_key, form_url, notes || null]
      : [convoy.org_id, convoyId, req.user.id, form_key, form_url, notes || null]
  );

  const completed = await finalizeConvoyCompletion(convoyId, convoy.org_id, req.user.id);

  res.status(201).json({ data: handoverResult.rows[0], convoy_completed: !!completed });
}));

module.exports = router;
