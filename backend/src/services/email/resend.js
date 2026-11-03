async function sendEmail({ from, to, replyTo, subject, html, text, attachments = [], idempotencyKey, tags = [] }) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured');
  const payload = { from, to: Array.isArray(to) ? to : [to], subject, html, text, tags };
  if (replyTo) payload.reply_to = Array.isArray(replyTo) ? replyTo : [replyTo];
  if (Array.isArray(attachments) && attachments.length) payload.attachments = attachments.map(a => ({ filename: a.filename, content: a.content, ...(a.contentType ? { content_type: a.contentType } : {}) }));
  const headers = { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    const err = new Error(body.error?.message || `Resend request failed with HTTP ${response.status}`);
    err.name = body.error?.name || 'ResendError'; err.statusCode = response.status; throw err;
  }
  if (!body.id) throw new Error('Resend returned no email id');
  return { id: body.id };
}

function isRetryableError(err) { const status = Number(err?.statusCode); if ([400,401,403,404,422].includes(status)) return false; return true; }
module.exports = { sendEmail, isRetryableError };
