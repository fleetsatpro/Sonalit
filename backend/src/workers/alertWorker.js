require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { Worker } = require('bullmq');
const { query } = require('../config/database');
const { getQueues } = require('../config/queue');
const { withOrg } = require('../utils/orgScopedDb');
const logger = require('../utils/logger');

const { publish } = require('../realtime/centrifugo');

const COOLDOWN_MINUTES = parseInt(process.env.ALERT_COOLDOWN_MINUTES) || 10;

function getRedisConnection() {
  const url = new URL(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  return {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: url.password || process.env.REDIS_PASSWORD || undefined,
  };
}

async function fireGeofenceActions(job, alert, type, severity, vehicle_id, message) {
  try {
    const isGeofenceAlert = job.data.geofence_id || type === 'route_deviation' || type === 'geofence';
    if (!isGeofenceAlert) return;

    const geofenceId = job.data.geofence_id || null;

    // Try to extract a geofence name from the message text
    let geofenceNameFromMsg = null;
    const corridorMatch = message && message.match(/corridor "(.+?)"/);
    const zoneMatch     = message && message.match(/zone "(.+?)"/);
    if (corridorMatch) geofenceNameFromMsg = corridorMatch[1];
    else if (zoneMatch) geofenceNameFromMsg = zoneMatch[1];

    // Extract distance string from message for template substitution
    let distanceFromMsg = '';
    const distMatch = message && message.match(/(\d+(?:\.\d+)?(?:m|km))/i);
    if (distMatch) distanceFromMsg = distMatch[1];

    const actionsResult = await query(
      `SELECT ga.*, g.name AS geofence_name
       FROM geofence_actions ga
       JOIN geofences g ON g.id = ga.geofence_id
       WHERE ga.enabled = true
         AND (ga.geofence_id = $1 OR g.name ILIKE $2)`,
      [geofenceId, geofenceNameFromMsg ? `%${geofenceNameFromMsg}%` : '__no_match__']
    );

    const actions = actionsResult.rows;
    if (!actions.length) return;

    const geofenceName = actions[0]?.geofence_name || geofenceNameFromMsg || '';

    for (const action of actions) {
      try {
        const resolvedName = action.geofence_name || geofenceName;

        // Build message from template
        let msg = (action.message_template || 'Alert: {severity} violation at {geofence} — vehicle {vehicle}')
          .replace(/\{vehicle\}/g,   vehicle_id)
          .replace(/\{geofence\}/g,  resolvedName)
          .replace(/\{distance\}/g,  distanceFromMsg)
          .replace(/\{severity\}/g,  severity);

        if (action.action_type === 'map_alert') {
          // geofence_actions don't have org_id; use alert's channel derived from convoy
          const geoOrgRes = await query(
            `SELECT c.org_id FROM alerts a JOIN convoys c ON c.id = a.convoy_id WHERE a.id = $1 LIMIT 1`,
            [alert.id]
          );
          const geoOrgId = geoOrgRes.rows[0]?.org_id ?? null;
          publish(geoOrgId ? `org#${geoOrgId}` : 'geofence:violation', {
            type: 'alert.new',
            alertId:      alert.id,
            geofenceName: resolvedName,
            vehicleId:    vehicle_id,
            alertType:    'geofence',
            severity,
            lat:          job.data.lat,
            lng:          job.data.lng,
          });

        } else if (action.action_type === 'sms') {
          if (process.env.AFRICASTALKING_API_KEY) {
            try {
              const fetch = require('node-fetch');
              const params = new URLSearchParams({
                username: process.env.AFRICASTALKING_USERNAME || 'sandbox',
                to:       action.recipient,
                message:  msg,
              });
              await fetch('https://api.africastalking.com/version1/messaging', {
                method:  'POST',
                headers: {
                  'apiKey':       process.env.AFRICASTALKING_API_KEY,
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'Accept':       'application/json',
                },
                body: params.toString(),
              });
              logger.info(`[SMS/AfricasTalking] Sent to ${action.recipient}`);
            } catch (e) {
              logger.warn(`[SMS/AfricasTalking] Failed: ${e.message}`);
            }
          } else if (process.env.TWILIO_SID) {
            try {
              const fetch = require('node-fetch');
              const auth = Buffer.from(`${process.env.TWILIO_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
              const params = new URLSearchParams({ To: action.recipient, From: process.env.TWILIO_FROM || '', Body: msg });
              await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`, {
                method:  'POST',
                headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                body:    params.toString(),
              });
              logger.info(`[SMS/Twilio] Sent to ${action.recipient}`);
            } catch (e) {
              logger.warn(`[SMS/Twilio] Failed: ${e.message}`);
            }
          } else {
            logger.info(`[SMS] Would send to ${action.recipient}: ${msg}`);
          }

        } else if (action.action_type === 'whatsapp') {
          if (process.env.AFRICASTALKING_API_KEY) {
            logger.info(`[WhatsApp/AfricasTalking] Would send to ${action.recipient}: ${msg}`);
          } else if (process.env.TWILIO_SID) {
            try {
              const fetch = require('node-fetch');
              const auth = Buffer.from(`${process.env.TWILIO_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
              const params = new URLSearchParams({
                To:   `whatsapp:${action.recipient}`,
                From: `whatsapp:${process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_FROM || ''}`,
                Body: msg,
              });
              await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`, {
                method:  'POST',
                headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                body:    params.toString(),
              });
              logger.info(`[WhatsApp/Twilio] Sent to ${action.recipient}`);
            } catch (e) {
              logger.warn(`[WhatsApp/Twilio] Failed: ${e.message}`);
            }
          } else {
            logger.info(`[WhatsApp] Would send to ${action.recipient}: ${msg}`);
          }

        } else if (action.action_type === 'email') {
          if (process.env.SMTP_HOST) {
            try {
              const nodemailer = require('nodemailer');
              const transporter = nodemailer.createTransport({
                host:   process.env.SMTP_HOST,
                port:   parseInt(process.env.SMTP_PORT) || 587,
                secure: process.env.SMTP_SECURE === 'true',
                auth: {
                  user: process.env.SMTP_USER,
                  pass: process.env.SMTP_PASS,
                },
              });
              await transporter.sendMail({
                from:    process.env.SMTP_FROM || process.env.SMTP_USER,
                to:      action.recipient,
                subject: `[FleetOps] ${severity.toUpperCase()} Geofence Alert — ${resolvedName}`,
                text:    msg,
              });
              logger.info(`[EMAIL] Sent to ${action.recipient}`);
            } catch (e) {
              logger.warn(`[EMAIL] Failed: ${e.message}`);
            }
          } else {
            logger.info(`[EMAIL] Would send to ${action.recipient}: ${msg}`);
          }
        }
      } catch (actionErr) {
        logger.warn(`[GeofenceAction] action=${action.action_type} failed: ${actionErr.message}`);
      }
    }
  } catch (err) {
    logger.warn(`[GeofenceActions] outer error: ${err.message}`);
  }
}

async function processAlert(job) {
  const { vehicle_id, convoy_id, type, severity, message } = job.data;
  if (!vehicle_id) throw new Error('Alert job missing vehicle_id');

  // Resolve tenant ownership from authoritative fleet data before any
  // tenant-bearing read/write. A queue payload may carry an org hint, but it
  // never gets to select the tenant.
  const owner = await query(
    `SELECT v.org_id AS vehicle_org_id,
            c.org_id AS convoy_org_id,
            c.id AS active_convoy_id
       FROM vehicles v
       LEFT JOIN convoys c
         ON c.id = v.assigned_convoy_id AND c.deleted_at IS NULL
      WHERE v.id = $1 AND v.deleted_at IS NULL`,
    [vehicle_id],
  );
  if (!owner.rows.length || !owner.rows[0].vehicle_org_id) {
    throw new Error(`Alert vehicle has no tenant scope: ${vehicle_id}`);
  }
  const orgId = owner.rows[0].vehicle_org_id;
  if (job.data.org_id && String(job.data.org_id) !== String(orgId)) {
    throw new Error('Alert job tenant mismatch');
  }
  if (convoy_id) {
    const convoyCheck = await query(
      'SELECT org_id FROM convoys WHERE id=$1 AND deleted_at IS NULL',
      [convoy_id],
    );
    const convoyOrg = convoyCheck.rows[0]?.org_id;
    if (!convoyOrg || String(convoyOrg) !== String(orgId)) {
      throw new Error('Alert job convoy tenant mismatch');
    }
  }

  return withOrg(orgId, async () => {
    // Deduplication: skip if same type for same vehicle within cooldown window
  const dupe = await query(
    `SELECT id FROM alerts
     WHERE vehicle_id = $1 AND type = $2 AND resolved_at IS NULL
       AND created_at > NOW() - INTERVAL '${COOLDOWN_MINUTES} minutes'
       AND deleted_at IS NULL
     LIMIT 1`,
    [vehicle_id, type]
  );

  if (dupe.rows.length) {
    logger.info(`Alert deduped (cooldown): vehicle=${vehicle_id} type=${type}`);
    return;
  }

    const result = await query(
      `INSERT INTO alerts (org_id, vehicle_id, convoy_id, type, severity, message, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW()) RETURNING *`,
      [orgId, vehicle_id, convoy_id || null, type, severity, message]
    );

  const alert = result.rows[0];

    publish(`org#${orgId}`, { type: 'alert.new', alertId: alert.id, vehicleId: vehicle_id, alertType: type, severity, message });

  const { notificationQueue } = getQueues();
  if (notificationQueue && (severity === 'high' || severity === 'critical')) {
    await notificationQueue.add('notify', { alertId: alert.id, severity });
  }

  logger.info(`Alert created: id=${alert.id} type=${type} severity=${severity}`);

  // Fire configured geofence actions for geofence/corridor alerts
  await fireGeofenceActions(job, alert, type, severity, vehicle_id, message);
  });
}

function startAlertWorker() {
  const connection = getRedisConnection();
  const worker = new Worker('alert', processAlert, { connection, concurrency: 5 });

  worker.on('completed', (job) => logger.info(`Alert job ${job.id} completed`));
  worker.on('failed', (job, err) => logger.error(`Alert job ${job?.id} failed: ${err.message}`));
  worker.on('error', (err) => logger.error(`Alert worker error: ${err.message}`));

  logger.info('Alert worker started');
  return worker;
}

module.exports = { startAlertWorker };
