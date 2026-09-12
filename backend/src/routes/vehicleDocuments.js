const router = require('express').Router({ mergeParams: true });
const Joi = require('joi');
const { asyncHandler } = require('../middleware/error');

const VALID_TYPES = ['insurance', 'roadworthy', 'registration', 'permit', 'inspection', 'other'];

const createDocSchema = Joi.object({
  type: Joi.string().valid(...VALID_TYPES).required(),
  label: Joi.string().min(1).max(200).required(),
  file_key: Joi.string().min(1).max(500).required(),
  expires_at: Joi.string().isoDate().optional(),
});

// GET /api/v1/vehicles/:vehicleId/documents
const listDocuments = asyncHandler(async (req, res) => {
  const { vehicleId } = req.params;

  const vehicle = await req.db(
    'SELECT id FROM vehicles WHERE id = $1 AND deleted_at IS NULL',
    [vehicleId]
  );
  if (!vehicle.rows.length) {
    return res.status(404).json({ error: 'Vehicle not found' });
  }

  const result = await req.db(
    `SELECT id, vehicle_id, type, label, file_key, expires_at, uploaded_at, uploaded_by
     FROM vehicle_documents
     WHERE vehicle_id = $1 AND deleted_at IS NULL
     ORDER BY uploaded_at DESC`,
    [vehicleId]
  );

  res.json({ data: result.rows });
});

// POST /api/v1/vehicles/:vehicleId/documents
const createDocument = asyncHandler(async (req, res) => {
  const { vehicleId } = req.params;

  const { error, value } = createDocSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.message });

  const vehicle = await req.db(
    'SELECT id FROM vehicles WHERE id = $1 AND deleted_at IS NULL',
    [vehicleId]
  );
  if (!vehicle.rows.length) {
    return res.status(404).json({ error: 'Vehicle not found' });
  }

  const result = await req.db(
    `INSERT INTO vehicle_documents
       (org_id, vehicle_id, type, label, file_key, expires_at, uploaded_at, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
     RETURNING id, vehicle_id, type, label, file_key, expires_at, uploaded_at, uploaded_by`,
    [
      req.user.org_id,
      vehicleId,
      value.type,
      value.label,
      value.file_key,
      value.expires_at || null,
      req.user.id,
    ]
  );

  res.status(201).json({ data: result.rows[0] });
});

// DELETE /api/v1/vehicles/:vehicleId/documents/:docId
const deleteDocument = asyncHandler(async (req, res) => {
  const { vehicleId, docId } = req.params;

  const result = await req.db(
    `UPDATE vehicle_documents
     SET deleted_at = NOW()
     WHERE id = $1 AND vehicle_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [docId, vehicleId]
  );

  if (!result.rows.length) {
    return res.status(404).json({ error: 'Document not found' });
  }

  res.json({ message: 'Document deleted' });
});

router.get('/', listDocuments);
router.post('/', createDocument);
router.delete('/:docId', deleteDocument);

module.exports = router;
