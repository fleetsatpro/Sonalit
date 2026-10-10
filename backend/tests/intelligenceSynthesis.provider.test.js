const request = require('supertest');
const fs = require('fs');
const path = require('path');

describe('intelligence synthesis provider contract', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../src/utils/aiClient', () => ({
      hasAnyProvider: () => true,
      hasAnthropic: () => false,
      hasGroqFallback: () => false,
      createMessage: async () => ({
        content: [{
          type: 'text',
          text: JSON.stringify([{
            story_id: 'story-test',
            headline: 'TEST SYNTHESIS',
            topic: 'SECURITY',
            brief: 'Evidence-backed synthesis',
            key_facts: ['Fact one'],
            why_it_matters: ['Operational context'],
            caveats: ['AI evidence only'],
            confidence_label: 'HIGH',
            operational_relevance: 'HIGH',
          }]),
        }],
      }),
    }));
  });

  test('keeps event synthesis classified independently from publications and uses one provider policy', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/utils/intelligenceAgents.js'), 'utf8');
    const start = source.indexOf('async function synthesizeEvents');
    const end = source.indexOf('  if(!Array.isArray(result)||!result.length)', start);
    const synthesis = source.slice(start, end);

    expect(synthesis).toContain("dataClassification:String(process.env.INTEL_EVENT_SYNTHESIS_DATA_CLASSIFICATION||process.env.INTEL_DEFAULT_DATA_CLASSIFICATION||'internal').toLowerCase()");
    expect(synthesis).not.toContain('INTEL_PUBLICATION_DATA_CLASSIFICATION');
    expect(synthesis).toContain('aiClient.hasAnyProvider(synthesisAiPolicy)');
    expect(synthesis).toContain('...synthesisAiPolicy');
    expect(synthesis).toContain('allowFreeProviders:true');
    expect(synthesis).toContain('preferFreeProviders:true');
    expect(synthesis).toContain("providerHints:['deepseek-v4-flash-openrouter','qwen3.5-397b-openrouter','gpt-oss-120b-groq']");
  });

  test('uses the any-provider capability rather than an Anthropic/Groq-only gate', async () => {
    const express = require('express');
    const router = require('../src/routes/intelligenceSynthesis');
    const app = express();
    app.use((req, _res, next) => {
      req.user = { org_id: '00000000-0000-0000-0000-000000000001' };
      req.db = async () => ({
        rows: [{
          id: '11111111-1111-1111-1111-111111111111',
          title: 'Test security development',
          summary: 'Evidence-backed development',
          description: null,
          country_code: 'KE',
          scope_type: 'country',
          scope_key: 'KE',
          severity: 'high',
          confidence: 80,
          status: 'fused',
          latitude: null,
          longitude: null,
          first_seen_at: '2026-10-02T09:00:00.000Z',
          last_seen_at: '2026-10-02T09:30:00.000Z',
          observation_count: 2,
          source_count: 2,
        }],
      });
      next();
    });
    app.use('/risk/intelligence/synthesis', router);
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

    const res = await request(app).get('/risk/intelligence/synthesis/stories?scope_type=global&scope_key=global');
    expect(res.status).toBe(200);
    expect(res.body.engine.ai_used).toBe(true);
    expect(res.body.engine.mode).toBe('AI_SYNTHESIS');
    expect(res.body.engine.stories_synthesized).toBe(1);
  });
});
