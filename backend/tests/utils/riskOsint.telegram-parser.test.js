'use strict';

jest.mock('../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../src/utils/telegramMtproto', () => ({
  fetchChannelMessages: jest.fn(),
  isConfigured: jest.fn(() => false),
  fetchPublicChannelPreview: jest.fn(),
}));
jest.mock('../../src/utils/aiClient', () => ({
  hasAnthropic: jest.fn(() => false),
  hasGroqFallback: jest.fn(() => false),
}));
jest.mock('../../src/utils/geocode', () => ({ geocodePlace: jest.fn() }));
jest.mock('../../src/utils/countryContinent', () => ({ continentForCountry: jest.fn() }));
jest.mock('../../src/realtime/centrifugo', () => ({ publish: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

describe('Telegram intelligence JSON parser', () => {
  test('accepts fenced JSON arrays', () => {
    const { parseModelJsonArray } = require('../../src/utils/riskOsint');
    expect(parseModelJsonArray('\\```json\\n[{"i":0,"text":"incident","level":"high"}]\\n\\`\\`\\`')).toHaveLength(1);
  });

  test('extracts a JSON array from surrounding model prose', () => {
    const { parseModelJsonArray } = require('../../src/utils/riskOsint');
    expect(parseModelJsonArray('Here is the result:\\n[{"i":0,"text":"incident","level":"high"}]\\n')).toEqual([
      { i: 0, text: 'incident', level: 'high' },
    ]);
  });

  test('returns an empty array for malformed content', () => {
    const { parseModelJsonArray } = require('../../src/utils/riskOsint');
    expect(parseModelJsonArray('not json [broken')).toEqual([]);
  });
});
