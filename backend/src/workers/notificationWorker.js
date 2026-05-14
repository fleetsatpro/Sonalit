require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { Worker } = require('bullmq');
const nodemailer = require('nodemailer');
const { query } = require('../config/database');
const logger = require('../utils/logger');

function getRedisConnection() {
  const url = new URL(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  return {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: url.password || process.env.REDIS_PASSWORD || undefined,
  };
}

function createTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    logger.warn('SMTP not configured — email notifications disabled');
    return null;
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
}

async function processNotification(job) {
  const { alertId, severity } = job.data;
  const transporter = createTransporter();
  if (!transporter) return;

  const alertResult = await query(
    `SELECT a.*, v.registration, v.region, c.name AS convoy_name
     FROM alerts a
     LEFT JOIN vehicles v ON v.id = a.vehicle_id
     LEFT JOIN convoys c ON c.id = a.convoy_id
     WHERE a.id = $1`,
    [alertId]
  );

  if (!alertResult.rows.length) {
    logger.warn(`Notification: alert ${alertId} not found`);
    return;
  }

  const alert = alertResult.rows[0];

  const recipients = await query(
    `SELECT email, name FROM users WHERE role IN ('admin', 'dispatcher') AND status = 'active' AND deleted_at IS NULL`
  );

  if (!recipients.rows.length) return;

  const severityEmoji = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
  const emoji = severityEmoji[severity] || '⚠️';

  const mailOptions = {
    from: process.env.SMTP_FROM || 'noreply@fleetops.local',
    to: recipients.rows.map((r) => r.email).join(', '),
    subject: `${emoji} FleetOps Alert [${severity.toUpperCase()}]: ${alert.type} — ${alert.registration || 'Unknown Vehicle'}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:auto">
        <div style="background:#080C14;padding:20px;border-radius:8px 8px 0 0">
          <h1 style="color:#F0B429;margin:0;font-size:20px">FleetOps Pro — ${severity.toUpperCase()} Alert</h1>
        </div>
        <div style="background:#0D1321;padding:24px;color:#e2e8f0;border-radius:0 0 8px 8px">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#94a3b8">Alert Type</td><td style="font-weight:bold">${alert.type}</td></tr>
            <tr><td style="padding:8px 0;color:#94a3b8">Severity</td><td style="font-weight:bold;color:#F0B429">${severity}</td></tr>
            <tr><td style="padding:8px 0;color:#94a3b8">Vehicle</td><td>${alert.registration || 'Unknown'}</td></tr>
            <tr><td style="padding:8px 0;color:#94a3b8">Region</td><td>${alert.region || 'Unknown'}</td></tr>
            <tr><td style="padding:8px 0;color:#94a3b8">Convoy</td><td>${alert.convoy_name || 'N/A'}</td></tr>
            <tr><td style="padding:8px 0;color:#94a3b8">Message</td><td>${alert.message}</td></tr>
            <tr><td style="padding:8px 0;color:#94a3b8">Time</td><td>${new Date(alert.created_at).toUTCString()}</td></tr>
          </table>
          <p style="margin-top:24px;font-size:12px;color:#64748b">This is an automated alert from FleetOps Pro.</p>
        </div>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Email notification sent for alert ${alertId} to ${recipients.rows.length} recipients`);
  } catch (err) {
    // Email failures must not crash the queue
    logger.error(`Email send failed for alert ${alertId}: ${err.message}`);
  }
}

function startNotificationWorker() {
  const connection = getRedisConnection();
  const worker = new Worker('notification', processNotification, { connection, concurrency: 3 });

  worker.on('completed', (job) => logger.info(`Notification job ${job.id} completed`));
  worker.on('failed', (job, err) => logger.error(`Notification job ${job?.id} failed: ${err.message}`));

  logger.info('Notification worker started');
  return worker;
}

module.exports = { startNotificationWorker };
