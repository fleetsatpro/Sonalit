/**
 * One-time interactive login for the Telegram MTProto client (GramJS) used
 * by the Risk Intel OSINT sweep to read public channels that don't expose
 * the https://t.me/s/<channel> web preview. This logs in as a real Telegram
 * user account, so it needs a phone number and the login code Telegram
 * sends — that can't be scripted/automated, run it yourself locally.
 *
 * Before running:
 *   1. Get an API ID + API hash from https://my.telegram.org (any Telegram
 *      account works — this doesn't have to be a dedicated/company number,
 *      but keep in mind the session this produces has full access to
 *      whatever account you log in with).
 *   2. Set TELEGRAM_API_ID and TELEGRAM_API_HASH in your shell or backend/.env
 *
 * Invocation:
 *   node scripts/telegram-login.js
 *
 * On success it prints a session string — set that as TELEGRAM_SESSION_STRING
 * in the backend's environment (Railway/production config, not committed to
 * git). Treat it like a password: anyone with it can act as this Telegram
 * account.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const readline = require('readline');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

(async () => {
  const apiId = parseInt(process.env.TELEGRAM_API_ID, 10);
  const apiHash = process.env.TELEGRAM_API_HASH;
  if (!apiId || !apiHash) {
    console.error('Set TELEGRAM_API_ID and TELEGRAM_API_HASH first (get them from https://my.telegram.org).');
    process.exit(1);
  }

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, { connectionRetries: 5 });

  await client.start({
    phoneNumber: () => ask('Phone number (with country code, e.g. +12025551234): '),
    phoneCode: () => ask('Login code Telegram just sent you: '),
    password: (hint) => ask(`2FA password${hint ? ` (hint: ${hint})` : ''} — leave blank if not set: `),
    // Only asked if this phone number has no Telegram account yet.
    firstAndLastNames: async () => {
      const first = await ask('This number has no Telegram account yet — first name for the new account: ');
      const last = await ask('Last name (optional, press enter to skip): ');
      return [first, last || undefined];
    },
    onError: (err) => { console.error('Auth error:', err.message); },
  });

  console.log('\nLogged in. Save this as TELEGRAM_SESSION_STRING in the backend environment:\n');
  console.log(client.session.save());
  console.log('\nThis string grants full access to this Telegram account — keep it out of git, treat it like a password.');

  await client.disconnect();
  process.exit(0);
})();
