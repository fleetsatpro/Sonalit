const crypto = require('crypto');
const { withOrg } = require('../../utils/orgScopedDb');
const { listCustomerPulseTargets, generateAndQueueScopedClientPulse } = require('./scopedClientPulse.service');
const { buildManifestWorkbook, isActiveRow } = require('./clientPulse.service');
const { queueClientPulseEmail } = require('./email.service');
const logger = require('../../utils/logger');

/**
 * Queue the global workbook for every enabled Super Admin recipient.
 * Super Admin authority is intentionally independent of CDS customer enrollment:
 * scheduled global visibility must never disappear merely because the admin is
 * not enrolled against a particular customer.
 */
async function generateAndQueueSuperAdminClientPulse(orgId, { snapshotAt = new Date(), reason = 'scheduled' } = {}) {
  const snapshot = snapshotAt instanceof Date ? snapshotAt : new Date(snapshotAt);
  const scheduled = reason === 'scheduled';
  const recipients = await withOrg(orgId, client => client.query(`
    SELECT DISTINCT email, name
    FROM client_email_recipients
    WHERE org_id=$1
      AND authority_role='super_admin'
      AND enabled=true
      AND deleted_at IS NULL
      AND email IS NOT NULL
    ORDER BY email
  `, [orgId]));

  if (!recipients.rows.length) return { skipped: true, reason: 'no_super_admin_recipients', queued: 0 };

  const idempotencyKey = scheduled
    ? `cds-client-pulse:super-admin:${snapshot.toISOString().slice(0, 13)}`
    : `cds-client-pulse:super-admin:manual:${snapshot.toISOString()}:${crypto.randomUUID()}`;

  const claim = await withOrg(orgId, client => client.query(`
    INSERT INTO cds_client_pulse_runs (org_id,snapshot_at,status,idempotency_key)
    VALUES ($1,$2,'generating',$3)
    ON CONFLICT (org_id,idempotency_key) DO NOTHING
    RETURNING id
  `, [orgId, snapshot, idempotencyKey]));
  if (!claim.rows.length) return { skipped: true, reason: 'duplicate_snapshot', queued: 0 };

  const runId = claim.rows[0].id;
  try {
    const { rows } = await withOrg(orgId, client => client.query(`
      SELECT bc.id,bc.booking_id,bc.container_number,bc.seal_number,bc.seal_number_2,
        bc.packing_list_no,bc.iso_type,bc.weight_kg,bc.status,bc.notes,bc.clamped_at,
        bc.unclamped_at,bc.terminal,bc.yard_status,bc.invoiced,bc.lock_number,
        bc.transporter_name,bc.horse_reg,bc.trailer_reg,bc.driver_name,bc.driver_contact,
        b.booking_number,b.reference AS file_reference,b.vessel,b.commodity,b.controller,
        b.country_code,b.direction,b.carrier_reference,b.status AS booking_status,
        b.pickup_location,b.delivery_location,b.eta,b.created_at AS booking_created_at,
        t.trip_number,t.status AS trip_status,
        COALESCE(bc.transporter_name,tr.company_name) AS transporter,
        COALESCE(bc.horse_reg,v.registration) AS horse_reg_derived,
        COALESCE(bc.driver_name,d.name) AS driver_name_derived,
        COALESCE(bc.driver_contact,d.phone) AS driver_contact_derived,
        l.serial AS lock_serial
      FROM cds_booking_containers bc
      JOIN cds_bookings b ON b.id=bc.booking_id
      LEFT JOIN cds_trips t ON t.id=bc.trip_id
      LEFT JOIN cds_transporters tr ON tr.id=t.transporter_id
      LEFT JOIN cds_vehicles v ON v.id=t.vehicle_id
      LEFT JOIN cds_drivers d ON d.id=t.driver_id
      LEFT JOIN cds_electronic_locks l ON l.id=t.lock_id
      WHERE bc.org_id=$1 AND bc.deleted_at IS NULL
        AND b.org_id=$1 AND b.deleted_at IS NULL
      ORDER BY b.created_at DESC NULLS LAST,b.id,bc.id
    `, [orgId]));

    const active = rows.filter(isActiveRow).map(row => ({
      booking_number: row.booking_number,
      carrier_reference: row.carrier_reference,
      vessel: row.vessel,
      file_reference: row.file_reference,
      controller: row.controller,
      commodity: row.commodity,
      packing_list_no: row.packing_list_no,
      container_number: row.container_number,
      iso_type: row.iso_type,
      seal_number: row.seal_number,
      seal_number_2: row.seal_number_2,
      status: row.status,
      clamped_at: row.clamped_at,
      clamped_at_t: row.clamped_at,
      unclamped_at: row.unclamped_at,
      lock_number: row.lock_number || row.lock_serial,
      terminal: row.terminal,
      yard_status: row.yard_status,
      transporter: row.transporter,
      horse_reg: row.horse_reg || row.horse_reg_derived,
      trailer_reg: row.trailer_reg,
      driver_name: row.driver_name || row.driver_name_derived,
      driver_contact: row.driver_contact || row.driver_contact_derived,
      invoiced: row.invoiced ? 'YES' : 'NO'
    }));

    const activeBookingCount = new Set(active.map(r => r.booking_number).filter(Boolean)).size;
    if (!active.length) {
      await withOrg(orgId, client => client.query(`
        UPDATE cds_client_pulse_runs
        SET status='skipped',active_booking_count=0,row_count=0,updated_at=NOW()
        WHERE id=$1
      `, [runId]));
      return { runId, skipped: true, reason: 'no_active_bookings', queued: 0 };
    }

    const workbook = await buildManifestWorkbook(active, snapshot);
    const filename = `ALL CLIENTS_Client Dispatch Master Active Bookings_${snapshot.toISOString().replace(/:/g,'').replace(/\\.\\d{3}Z$/,'Z')}_EAT.xlsx`;
    const result = await queueClientPulseEmail({
      orgId,
      recipients: recipients.rows.map(r => r.email),
      snapshotAt: snapshot.toISOString(),
      activeBookingCount,
      dateLabel: new Intl.DateTimeFormat('en-GB', {
        timeZone: process.env.CDS_CLIENT_PULSE_TIMEZONE || 'Africa/Nairobi',
        day: '2-digit', month: 'short', year: 'numeric'
      }).format(snapshot),
      attachment: {
        filename,
        content: workbook.toString('base64'),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      },
      correlationId: `cds-client-pulse:${runId}`,
      idempotencyKey
    });

    const ids = await withOrg(orgId, client => client.query(`
      SELECT id FROM email_notifications
      WHERE org_id=$1 AND notification_type='cds_client_pulse' AND correlation_id=$2
      ORDER BY created_at DESC
    `, [orgId, `cds-client-pulse:${runId}`]));

    await withOrg(orgId, client => client.query(`
      UPDATE cds_client_pulse_runs
      SET status=$2,active_booking_count=$3,row_count=$4,attachment_name=$5,
          email_notification_ids=$6,updated_at=NOW()
      WHERE id=$1
    `, [runId, result.queued ? 'queued' : 'skipped', activeBookingCount, active.length, filename, ids.rows.map(r => r.id)]));

    return {
      runId,
      queued: result.queued,
      duplicate: result.duplicate,
      rows: active.length,
      recipients: recipients.rows.length,
      filename,
      reason
    };
  } catch (error) {
    await withOrg(orgId, client => client.query(`
      UPDATE cds_client_pulse_runs
      SET status='failed',error=$2,updated_at=NOW()
      WHERE id=$1
    `, [runId, String(error.message || error).slice(0, 4000)]));
    logger.error(`Super Admin CDS Client Pulse failed: org=${orgId} run=${runId} error=${error.message}`);
    throw error;
  }
}

/**
 * Canonical Client Pulse dispatcher. Scheduled and manual callers use this
 * service so global Super Admin visibility and customer-scoped delivery stay
 * on the same pipeline.
 */
async function dispatchClientPulse(orgId, { snapshotAt = new Date(), reason = 'scheduled' } = {}) {
  if (!orgId) throw new Error('orgId is required for Client Pulse dispatch');
  const snapshot = snapshotAt instanceof Date ? snapshotAt : new Date(snapshotAt);
  if (Number.isNaN(snapshot.getTime())) throw new Error('Invalid Client Pulse snapshot time');

  const global = await generateAndQueueSuperAdminClientPulse(orgId, {
    snapshotAt: snapshot,
    reason
  });
  const customerIds = await listCustomerPulseTargets(orgId);
  const results = [];
  for (const customerId of customerIds) {
    try {
      results.push(await generateAndQueueScopedClientPulse(orgId, customerId, {
        snapshotAt: snapshot,
        reason
      }));
    } catch (error) {
      results.push({
        customerId,
        skipped: true,
        reason: 'delivery_failed',
        error: String(error.message || error)
      });
    }
  }

  return {
    snapshotAt: snapshot.toISOString(),
    global,
    customers: results,
    queued: (global.queued || 0) + results.filter(r => r.queued).length,
    skipped: (global.skipped ? 1 : 0) + results.filter(r => r.skipped).length,
    failed: (global.reason === 'delivery_failed' ? 1 : 0) + results.filter(r => r.reason === 'delivery_failed').length,
    customerCount: customerIds.length
  };
}

module.exports = { dispatchClientPulse, generateAndQueueSuperAdminClientPulse };
