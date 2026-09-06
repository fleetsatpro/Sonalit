// MTProto Telegram client (GramJS) for reading public-channel messages that
// don't expose the https://t.me/s/<channel> web preview — the Bot API can't
// help there either, since a bot only receives posts from channels where an
// admin of that specific channel added it, and these are third-party news
// channels we don't administer (SaharaReporters, ChannelsTV, etc.). GramJS
// logs in as a real Telegram user account instead, the same way a person
// would in the app, and can read any public channel's message history that
// way — no admin/ownership on the channel needed.
//
// One-time setup (interactive, can't be automated from here):
//   1. Get TELEGRAM_API_ID + TELEGRAM_API_HASH from https://my.telegram.org
//   2. Run `node backend/scripts/telegram-login.js` locally and follow the
//      phone number / login code prompts
//   3. Copy the session string it prints into TELEGRAM_SESSION_STRING
// Until all three env vars are set, fetchChannelMessages() returns []
// unconditionally — same opt-in pattern as ACLED/Claude.
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { ConnectionTCPObfuscated } = require('telegram/network/connection/TCPObfuscated');
const logger = require('./logger');

let client = null;
let connectPromise = null;

function isConfigured() {
  return !!(process.env.TELEGRAM_API_ID && process.env.TELEGRAM_API_HASH && process.env.TELEGRAM_SESSION_STRING);
}

async function getClient() {
  if (!isConfigured()) return null;
  if (client?.connected) return client;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    const apiId = parseInt(process.env.TELEGRAM_API_ID, 10);
    const apiHash = process.env.TELEGRAM_API_HASH;
    // TCPObfuscated rather than the default TCPFull — some networks (this
    // one included, observed during setup) silently drop the plain TCPFull
    // handshake with no error, while the obfuscated transport gets through.
    //
    // reconnectRetries defaults to Infinity in GramJS, and its internal
    // auto-reconnect (MTProtoSender.reconnect/_reconnect) doesn't check our
    // disconnect()/destroy() flag before re-establishing the connection —
    // a network hiccup mid-sweep spins up a reconnect loop that keeps
    // retrying forever, races past destroy() when one is already in
    // flight, and logs "Error: TIMEOUT"/"Error: Not connected" every
    // 30-90s indefinitely (observed in production for 16+ minutes after a
    // sweep had already finished and tried to clean up — see PR history).
    // We connect fresh once per sweep and explicitly destroy() afterwards,
    // so there's no reason for GramJS to keep fighting to reconnect on its
    // own — reconnectRetries: 0 makes a dropped connection terminal
    // (MTProtoSender's own retry-count check then sets userDisconnected
    // and exits its loops for real) instead of an unstoppable retry loop.
    const c = new TelegramClient(new StringSession(process.env.TELEGRAM_SESSION_STRING), apiId, apiHash, {
      connectionRetries: 5,
      reconnectRetries: 0,
      autoReconnect: false,
      connection: ConnectionTCPObfuscated,
    });
    await c.connect();
    client = c;
    return c;
  })();

  try {
    return await connectPromise;
  } finally {
    connectPromise = null;
  }
}

// One channel per call, each independently caught by the sweep — a single
// unresolvable/renamed username shouldn't take down every other channel's
// fetch for the cycle.
async function fetchChannelMessages(channelUsername, sinceMs) {
  const c = await getClient();
  if (!c) return [];

  const messages = await c.getMessages(channelUsername, { limit: 30 });
  return messages
    .filter(m => m.message && m.date && m.date * 1000 >= sinceMs)
    .map(m => ({
      id: `${channelUsername}/${m.id}`,
      text: m.message,
      postedAt: m.date * 1000,
    }));
}

async function disconnect() {
  if (client) {
    // client.disconnect() only closes the socket — GramJS's internal ping/
    // update loop keeps running (it only checks client._destroyed, a flag
    // disconnect() never sets), so it spins forever re-pinging a dead
    // connection and logging "Error: TIMEOUT" every ~9s. destroy() sets
    // that flag first, which lets the loop exit on its next iteration.
    // https://github.com/gram-js/gramjs/issues/615
    //
    // Clear the module-level reference *before* awaiting destroy() (not
    // after) so a getClient() call that runs while destroy() is still
    // settling never hands back this instance — with reconnectRetries: 0
    // above this matters less than it used to, but a client mid-teardown
    // is never something a fresh call should reuse either way.
    const dying = client;
    client = null;
    await dying.destroy().catch((e) => logger.warn(`Telegram MTProto disconnect error: ${e.message}`));
  }
}

module.exports = { isConfigured, fetchChannelMessages, disconnect };
