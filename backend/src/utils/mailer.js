/**
 * Outbound mail for public-facing forms.
 *
 * Same two-provider arrangement the portal magic-link route uses: Resend when
 * RESEND_API_KEY is set, nodemailer SMTP otherwise. Kept as a small shared
 * helper so new callers do not each grow their own copy; portalAuth.js still
 * has its own inline version and is deliberately left alone here, since that
 * is a working authentication path and this change has no reason to touch it.
 *
 * Returns true when a provider accepted the message, false when none is
 * configured. Throws when a configured provider rejects the send, so callers
 * can tell "no mail set up" apart from "mail is broken".
 */
const nodemailer = require('nodemailer');

const DEFAULT_FROM = 'SONALIT <noreply@sonalit.io>';

async function sendMail({ to, subject, text, replyTo }) {
  const from = process.env.SMTP_FROM || DEFAULT_FROM;

  if (process.env.RESEND_API_KEY) {
    const body = { from, to: [to], subject, text };
    if (replyTo) body.reply_to = [replyTo];
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Resend: ${err.message || resp.status}`);
    }
    return true;
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    });
    const message = { from, to, subject, text };
    if (replyTo) message.replyTo = replyTo;
    await transporter.sendMail(message);
    return true;
  }

  return false;
}

module.exports = { sendMail };
