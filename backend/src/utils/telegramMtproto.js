// MTProto Telegram client (GramJS) for reading public-channel messages that
// don't expose the https://t.me/s/<channel> web preview. It is an optional
// accelerator; the Risk Intel sweep has a public-preview scraper fallback.
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { ConnectionTCPObfuscated } = require('telegram/network/connection/TCPObfuscated');
const logger = require('./logger');

let client = null;
let connectPromise = null;
let sessionDisabled = false;

function isConfigured() {
  return !sessionDisabled && !!(
    process.env.TELEGRAM_API_ID
    && process.env.TELEGRAM_API_HASH
    && process.env.TELEGRAM_SESSION_STRING
  );
}

function isAuthKeyDuplicated(error) {
  return /AUTH_KEY_DUPLICATED/i.test(String(error?.message || error));
}

async function getClient() {
  if (!isConfigured()) return null;
  if (client?.connected) return client;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    const apiId = parseInt(process.env.TELEGRAM_API_ID, 10);
    const apiHash = process.env.TELEGRAM_API_HASH;
    // GramJS documents connectionRetries/reconnectRetries and autoReconnect;
    // keep reconnecting disabled here because a duplicated MTProto auth key
    // is a terminal session condition, not a transient network failure.
    const c = new TelegramClient(new StringSession(process.env.TELEGRAM_SESSION_STRING), apiId, apiHash, {
      connectionRetries: 5,
      reconnectRetries: 0,
      autoReconnect: false,
      connection: ConnectionTCPObfuscated,
    });
    try {
      await c.connect();
      client = c;
      return c;
    } catch (error) {
      if (isAuthKeyDuplicated(error)) {
        sessionDisabled = true;
        logger.warn('Risk Intel OSINT: Telegram MTProto session is invalid/duplicated; disabling MTProto for this process and using public-preview fallback. A fresh Telegram session string is required to restore MTProto.');
        await c.destroy().catch(() => {});
        return null;
      }
      throw error;
    }
  })();

  try {
    return await connectPromise;
  } finally {
    connectPromise = null;
  }
}

async function fetchChannelMessages(channelUsername, sinceMs) {
  const c = await getClient();
  if (!c) return [];

  try {
    const messages = await c.getMessages(channelUsername, { limit: 30 });
    return messages
      .filter(m => m.message && m.date && m.date * 1000 >= sinceMs)
      .map(m => ({
        id: `${channelUsername}/${m.id}`,
        text: m.message,
        postedAt: m.date * 1000,
      }));
  } catch (error) {
    if (isAuthKeyDuplicated(error)) {
      sessionDisabled = true;
      const dying = client;
      client = null;
      await dying?.destroy().catch(() => {});
      logger.warn('Risk Intel OSINT: Telegram MTProto auth key was invalidated; disabling MTProto and falling back to public-preview scraping.');
      return [];
    }
    throw error;
  }
}

async function disconnect() {
  const dying = client;
  client = null;
  if (dying) {
    await dying.destroy().catch((e) => logger.warn(`Telegram MTProto disconnect error: ${e.message}`));
  }
}

module.exports = { isConfigured, fetchChannelMessages, disconnect };
