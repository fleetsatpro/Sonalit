const { Resend } = require('resend');
const logger = require('../../utils/logger');

let client = null;

function getResend() {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

async function sendEmail({ from, to, replyTo, subject, html, text, idempotencyKey, tags = [] }) {
  const resend = getResend();
  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    replyTo: replyTo ? (Array.isArray(replyTo) ? replyTo : [replyTo]) : undefined,
    subject,
    html,
    text,
    tags,
  };

  // Resend supports provider-side idempotency. The SDK exposes request options
  // as the second argument to emails.send(). Keep this key stable for retries.
  const options = idempotencyKey ? { idempotencyKey } : undefined;
  const result = await resend.emails.send(payload, options);

  if (result.error) {
    const err = new Error(result.error.message || 'Resend email request failed');
    err.name = result.error.name || 'ResendError';
    err.statusCode = result.error.statusCode;
    throw err;
  }

  if (!result.data || !result.data.id) throw new Error('Resend returned no email id');
  return result.data;
}

function isRetryableError(err) {
  const status = Number(err?.statusCode);
  if ([400, 401, 403, 404, 422].includes(status)) return false;
  return true;
}

module.exports = { getResend, sendEmail, isRetryableError };
