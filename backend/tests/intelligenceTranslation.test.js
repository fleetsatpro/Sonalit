'use strict';

const fs = require('fs');
const path = require('path');

describe('intelligence source translation provider mesh', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.INTEL_TRANSLATION_DATA_CLASSIFICATION;
    jest.doMock('../src/utils/logger', () => ({
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    }));
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('uses an eligible public provider mesh without requiring Anthropic or Groq', async () => {
    const mockAiClient = {
      hasAnyProvider: jest.fn(() => true),
      hasAnthropic: jest.fn(() => false),
      hasGroqFallback: jest.fn(() => false),
      createMessage: jest.fn(async () => ({
        content: [{
          type: 'text',
          text: JSON.stringify([{
            id: 'observation-1',
            translated_title: 'Security incident near the border',
            translated_body: 'Local authorities reported an incident near the border.',
          }]),
        }],
      })),
    };
    jest.doMock('../src/utils/aiClient', () => mockAiClient);

    const { translateItems } = require('../src/utils/intelligenceTranslation');
    const result = await translateItems([{
      id: 'observation-1',
      language: 'fr',
      title: 'Incident de sécurité près de la frontière',
      body: 'Les autorités locales ont signalé un incident près de la frontière.',
    }]);

    expect(mockAiClient.hasAnyProvider).toHaveBeenCalledWith(expect.objectContaining({
      dataClassification: 'public',
      allowFreeProviders: true,
      preferFreeProviders: true,
      providerHints: expect.arrayContaining([
        'google-gemini-3.8-flash',
        'openrouter-free-router',
        'gpt-oss-120b-openrouter-free',
      ]),
    }));
    expect(mockAiClient.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      dataClassification: 'public',
      allowFreeProviders: true,
      preferFreeProviders: true,
      providerHints: expect.arrayContaining(['openrouter-free-router']),
    }));
    expect(result.get('observation-1')).toEqual({
      title: 'Security incident near the border',
      body: 'Local authorities reported an incident near the border.',
    });
  });

  test('respects an explicit translation classification and does not call a disabled provider fabric', async () => {
    process.env.INTEL_TRANSLATION_DATA_CLASSIFICATION = 'internal';
    const mockAiClient = {
      hasAnyProvider: jest.fn(() => false),
      hasAnthropic: jest.fn(() => false),
      hasGroqFallback: jest.fn(() => false),
      createMessage: jest.fn(),
    };
    jest.doMock('../src/utils/aiClient', () => mockAiClient);

    const { translateItems } = require('../src/utils/intelligenceTranslation');
    const result = await translateItems([{ id: 'observation-2', language: 'sw', title: 'Habari', body: 'Maelezo' }]);

    expect(mockAiClient.hasAnyProvider).toHaveBeenCalledWith(expect.objectContaining({
      dataClassification: 'internal',
      allowFreeProviders: true,
    }));
    expect(mockAiClient.createMessage).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  test('failed translations remain in the bounded retry queue', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/utils/intelligenceAgents.js'), 'utf8');
    const start = source.indexOf('async function translateQueue');
    const end = source.indexOf('async function synthesizeEvents', start);
    const queue = source.slice(start, end);

    expect(queue).toContain("translation_status IN ('pending','failed')");
    expect(queue).toContain('ORDER BY observed_at DESC LIMIT $2');
    expect(queue).toContain("translation_status='failed'");
    expect(queue).toContain("translation_status='translated'");
  });
});
