describe('Telegram MTProto configuration gate', () => {
  const original = {
    TELEGRAM_ENABLE_MTPROTO: process.env.TELEGRAM_ENABLE_MTPROTO,
    TELEGRAM_API_ID: process.env.TELEGRAM_API_ID,
    TELEGRAM_API_HASH: process.env.TELEGRAM_API_HASH,
    TELEGRAM_SESSION_STRING: process.env.TELEGRAM_SESSION_STRING,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    jest.resetModules();
  });

  test('requires explicit enable flag even when credentials exist', () => {
    process.env.TELEGRAM_API_ID = '12345';
    process.env.TELEGRAM_API_HASH = 'hash';
    process.env.TELEGRAM_SESSION_STRING = 'session';
    delete process.env.TELEGRAM_ENABLE_MTPROTO;
    const mod = require('../../src/utils/telegramMtproto');
    expect(mod.isConfigured()).toBe(false);
  });

  test('enables MTProto only when explicitly enabled and credentials exist', () => {
    process.env.TELEGRAM_ENABLE_MTPROTO = 'true';
    process.env.TELEGRAM_API_ID = '12345';
    process.env.TELEGRAM_API_HASH = 'hash';
    process.env.TELEGRAM_SESSION_STRING = 'session';
    const mod = require('../../src/utils/telegramMtproto');
    expect(mod.isConfigured()).toBe(true);
  });

  test('disabled MTProto leaves public-preview fallback available', async () => {
    process.env.TELEGRAM_ENABLE_MTPROTO = 'false';
    delete process.env.TELEGRAM_API_ID;
    delete process.env.TELEGRAM_API_HASH;
    delete process.env.TELEGRAM_SESSION_STRING;
    const mod = require('../../src/utils/telegramMtproto');
    expect(mod.isConfigured()).toBe(false);
    await expect(mod.fetchChannelMessages('example', Date.now())).resolves.toEqual([]);
  });
});