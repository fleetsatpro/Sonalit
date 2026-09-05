const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { query } = require('../../config/database');
const { withOrg } = require('../../utils/orgScopedDb');
const logger = require('../../utils/logger');
const { queueClientPulseEmail, stableKey } = require('./email.service');

const MANIFEST_COLUMNS = [
  ['booking_number', 'BOOKING NO'], ['carrier_reference', 'CARRIER REF'], ['vessel', 'VESSEL'],
  ['file_reference', 'AW FILE REF NO'], ['controller', 'CONTROLLER'], ['commodity', 'COMMODITY'],
  ['packing_list_no', 'PACKING LIST NO'], ['container_number', 'CONTAINER NO'], ['iso_type', 'TYPE'],
  ['seal_number', 'SEAL 1'], ['seal_number_2', 'SEAL 2'], ['status', 'STAGE'], ['clamped_at', 'DATE CLAMPED'],
  ['clamped_at_t', 'TIME CLAMPED'], ['unclamped_at', 'TIME UNCLAMPED'], ['lock_number', 'LOCK NO'],
  ['terminal', 'TERMINAL'], ['yard_status', 'LOCATION'], ['transporter', 'TRANSPORTER'], ['horse_reg', 'HORSE REG'],
  ['trailer_reg', 'TRAILER REG'], ['driver_name', 'DRIVER NAME'], ['driver_contact', 'DRIVER CONTACT'], ['invoiced', 'INVOICED'],
];
const ACTIVE_CONTAINER_STATUSES = new Set(['pending', 'assigned', 'in_transit', 'at_port']);
const INACTIVE_BOOKING_STATUSES = new Set(['completed', 'delivered', 'cancelled', 'canceled', 'archived', 'closed']);

function isActiveRow(row) {
  const bookingStatus = String(row.booking_status || '').toLowerCase();
  const containerStatus = String(row.status || '').toLowerCase();
  if (INACTIVE_BOOKING_STATUSES.has(bookingStatus)) return false;
  return ACTIVE_CONTAINER_STATUSES.has(containerStatus) || !['delivered', 'completed'].includes(containerStatus);
}

async function fetchManifestSnapshot(orgId) {
  return withOrg(orgId, client => client.query(`
    SELECT bc.id, bc.booking_id, bc.container_number, bc.seal_number, bc.seal_number_2,
           bc.packing_list_no, bc.iso_type, bc.weight_kg, bc.status, bc.notes,
           bc.clamped_at, bc.unclamped_at, bc.terminal, bc.yard_status, bc.invoiced,
           bc.lock_number, bc.transporter_name, bc.horse_reg, bc.trailer_reg,
           bc.driver_name, bc.driver_contact,
           b.booking_number, b.reference AS file_reference, b.vessel, b.commodity,
           b.controller, b.country_code, b.direction, b.carrier_reference,
           b.status AS booking_status, b.pickup_location, b.delivery_location, b.eta,
           b.created_at AS booking_created_at,
           cu.company_name AS customer_name,
           t.trip_number, t.status AS trip_status,
           COALESCE(bc.transporter_name, tr.company_name) AS transporter,
           COALESCE(bc.horse_reg, v.registration) AS horse_reg_derived,
           COALESCE(bc.driver_name, d.name) AS driver_name_derived,
           COALESCE(bc.driver_contact, d.phone) AS driver_contact_derived,
           l.serial AS lock_serial
      FROM cds_booking_containers bc
      JOIN cds_bookings b ON b.id = bc.booking_id
      LEFT JOIN cds_customers cu ON cu.id = b.customer_id
      LEFT JOIN cds_trips t ON t.id = bc.trip_id
      LEFT JOIN cds_transporters tr ON tr.id = t.transporter_id
      LEFT JOIN cds_vehicles v ON v.id = t.vehicle_id
      LEFT JOIN cds_drivers d ON d.id = t.driver_id
      LEFT JOIN cds_electronic_locks l ON l.id = t.lock_id
     WHERE bc.org_id = $1 AND bc.deleted_at IS NULL AND b.org_id = $1 AND b.deleted_at IS NULL
     ORDER BY b.created_at DESC NULLS LAST, b.id, bc.id`, [orgId]));
}

function manifestRow(row) {
  return {
    booking_number: row.booking_number, carrier_reference: row.carrier_reference, vessel: row.vessel,
    file_reference: row.file_reference, controller: row.controller, commodity: row.commodity,
    packing_list_no: row.packing_list_no, container_number: row.container_number, iso_type: row.iso_type,
    seal_number: row.seal_number, seal_number_2: row.seal_number_2, status: row.status,
    clamped_at: row.clamped_at, clamped_at_t: row.clamped_at, unclamped_at: row.unclamped_at,
    lock_number: row.lock_number || row.lock_serial, terminal: row.terminal, yard_status: row.yard_status,
    transporter: row.transporter, horse_reg: row.horse_reg || row.horse_reg_derived, trailer_reg: row.trailer_reg,
    driver_name: row.driver_name || row.driver_name_derived, driver_contact: row.driver_contact || row.driver_contact_derived,
    invoiced: row.invoiced ? 'YES' : 'NO',
  };
}

function excelValue(key, value) {
  if (value == null || value === '') return '';
  if ((key === 'clamped_at' || key === 'clamped_at_t' || key === 'unclamped_at') && value) {
    const d = new Date(value); if (!Number.isNaN(d.getTime())) return d;
  }
  return value;
}

async function buildManifestWorkbook(rows, snapshotAt) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Sonalit'; workbook.lastModifiedBy = 'Sonalit';
  workbook.created = snapshotAt; workbook.modified = snapshotAt;
  workbook.properties.title = 'CDS Active Booking Manifest';
  workbook.properties.subject = 'Sonalit CDS Client Pulse';
  workbook.properties.description = 'Active Booking Manifest snapshot generated by Sonalit';
  const sheet = workbook.addWorksheet('Booking Manifest', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + Math.min(MANIFEST_COLUMNS.length, 26))}1` };
  sheet.columns = MANIFEST_COLUMNS.map(([key, header]) => ({ header, key, width: Math.max(12, Math.min(32, header.length + 4)) }));
  const header = sheet.getRow(1);
  header.font = { bold: true }; header.alignment = { vertical: 'middle' }; header.height = 22;
  for (const cell of header.cells) cell.border = { bottom: { style: 'thin' } };
  for (const row of rows) {
    const data = {};
    for (const [key] of MANIFEST_COLUMNS) data[key] = excelValue(key, row[key]);
    sheet.addRow(data);
  }
  for (const key of ['clamped_at', 'clamped_at_t', 'unclamped_at']) {
    const col = sheet.getColumn(key); col.numFmt = key === 'clamped_at' ? 'dd/mm/yyyy' : 'hhmm"hrs"';
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function resolveClientPulseRecipients(orgId) {
  const result = await withOrg(orgId, client => client.query(`
    SELECT DISTINCT c.email, c.name
      FROM cargo_clients c
      JOIN client_notification_prefs p ON p.client_id = c.id AND p.org_id = c.org_id
     WHERE c.org_id = $1 AND c.deleted_at IS NULL
       AND ('cds_client_pulse' = ANY(p.events) OR 'client_pulse' = ANY(p.events))
       AND ('email' = ANY(p.channels) OR 'email' = ANY(p.channels)::text[])
       AND (p.convoy_id IS NULL OR EXISTS (
         SELECT 1 FROM cargo_client_links l
          WHERE l.client_id = c.id AND l.convoy_id = p.convoy_id AND l.org_id = $1
       ))`, [orgId]));
  return result.rows;
}

function dateLabel(date) { return new Intl.DateTimeFormat('en-GB', { timeZone: process.env.CDS_CLIENT_PULSE_TIMEZONE || 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric' }).format(date); }

async function generateAndQueueClientPulse(orgId, { snapshotAt = new Date() } = {}) {
  if (!orgId) throw new Error('orgId is required for Client Pulse');
  const snapshot = snapshotAt instanceof Date ? snapshotAt : new Date(snapshotAt);
  const idempotencyKey = `cds-client-pulse:${snapshot.toISOString().slice(0, 13)}`;
  const claim = await withOrg(orgId, client => client.query(`INSERT INTO cds_client_pulse_runs (org_id, snapshot_at, status, idempotency_key) VALUES ($1,$2,'generating',$3) ON CONFLICT (org_id,idempotency_key) DO NOTHING RETURNING id`, [orgId, snapshot, idempotencyKey]));
  if (!claim.rows.length) return { skipped: true, reason: 'duplicate_snapshot' };
  const runId = claim.rows[0].id;
  try {
    const raw = await fetchManifestSnapshot(orgId);
    const active = raw.rows.filter(isActiveRow).map(manifestRow);
    const recipients = await resolveClientPulseRecipients(orgId);
    if (!recipients.length) {
      await query(`UPDATE cds_client_pulse_runs SET status='skipped', active_booking_count=$2, row_count=$3, updated_at=NOW() WHERE id=$1`, [runId, new Set(active.map(r => r.booking_number).filter(Boolean)).size, active.length]);
      return { skipped: true, reason: 'no_opted_in_recipients', rows: active.length };
    }
    const workbook = await buildManifestWorkbook(active, snapshot);
    if (!workbook.length) throw new Error('Generated Client Pulse workbook is empty');
    const manifestHash = crypto.createHash('sha256').update(workbook).digest('hex');
    const stamp = snapshot.toISOString().replace(/[:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const filename = `CDS_Client_Pulse_Active_Bookings_${stamp}_EAT.xlsx`;
    const result = await queueClientPulseEmail({
      orgId, recipients: recipients.map(r => r.email), snapshotAt: snapshot.toISOString(),
      activeBookingCount: new Set(active.map(r => r.booking_number).filter(Boolean)).size,
      dateLabel: dateLabel(snapshot),
      attachment: { filename, content: workbook.toString('base64'), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      correlationId: `cds-client-pulse:${runId}`, idempotencyKey,
    });
    const ids = await withOrg(orgId, client => client.query(`SELECT id FROM email_notifications WHERE org_id=$1 AND notification_type='cds_client_pulse' AND correlation_id=$2 ORDER BY created_at DESC`, [orgId, `cds-client-pulse:${runId}`]));
    await query(`UPDATE cds_client_pulse_runs SET status=$2, active_booking_count=$3, row_count=$4, attachment_name=$5, manifest_hash=$6, email_notification_ids=$7, updated_at=NOW() WHERE id=$1`, [runId, result.queued ? 'queued' : 'skipped', new Set(active.map(r => r.booking_number).filter(Boolean)).size, active.length, filename, manifestHash, ids.rows.map(r => r.id)]);
    return { runId, queued: result.queued, duplicate: result.duplicate, rows: active.length, recipients: recipients.length, filename, manifestHash };
  } catch (err) {
    await query(`UPDATE cds_client_pulse_runs SET status='failed', error=$2, updated_at=NOW() WHERE id=$1`, [runId, String(err.message || err).slice(0, 4000)]);
    logger.error(`CDS Client Pulse failed: org=${orgId} run=${runId} error=${err.message}`);
    throw err;
  }
}

module.exports = { MANIFEST_COLUMNS, isActiveRow, fetchManifestSnapshot, buildManifestWorkbook, resolveClientPulseRecipients, generateAndQueueClientPulse };
