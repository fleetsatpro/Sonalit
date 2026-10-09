'use strict';

const fs = require('fs');
const path = require('path');
const { publicationRecoveryMetadata } = require('../src/utils/publicationRecoveryMetadata');

describe('publication research retry wiring', () => {
  test('retries only use the tenant-scoped original period and canonical publication pipeline', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/routes/communicationsControl.js'), 'utf8');
    expect(source).toContain("router.post('/publications/:id/retry-research'");
    expect(source).toContain("WHERE id=$1 AND org_id=$2");
    expect(source).toContain("['draft', 'review'].includes(String(publication.status || '').toLowerCase())");
    expect(source).toContain("new Date(periodEnd.getTime() - 1000), forceResearch: true, recovery: true");
    expect(source).toContain('renderAndStorePublicationPdf(req.user.org_id, publicationId)');
  });

  test('publication desk exposes recovery and distinguishes query failures, held releases and PDF failures', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../apps/web/src/pages/IntelligencePublicationDesk.tsx'), 'utf8');
    expect(source).toContain("'/retry-research'");
    expect(source).toContain('RETRY RESEARCH');
    expect(source).toContain('PUBLICATION SERVICE UNAVAILABLE');
    expect(source).toContain('PUBLISHED · GATE UNVERIFIED');
    expect(source).toContain("s==='failed')return 'FAILED'");
    expect(source).toContain("x.pdf_error||'Generation failed; retry report rendering.'");
    expect(source).toContain("!q.isPending&&!q.isError&&!items.length");
  });

  test('autonomous recovery performs its candidate query within the organization-scoped database transaction', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/utils/intelligenceAgents.js'), 'utf8');
    const start = source.indexOf('async function recoverStalledPublications');
    const end = source.indexOf('function publicationForCountry', start);
    const recovery = source.slice(start, end);
    expect(recovery).toContain('withOrg(orgId,client=>client.query(');
    expect(recovery).toMatch(/LIMIT \$4`,\s*\[orgId,now,staleMinutes,limit\]\s*\)\);/);
    expect(recovery).not.toContain('await query(');
  });

  test('autonomous retries are persisted, bounded, and fail closed for malformed counters', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/utils/intelligenceAgents.js'), 'utf8');
    const start = source.indexOf('async function recoverStalledPublications');
    const end = source.indexOf('function publicationForCountry', start);
    const recovery = source.slice(start, end);
    expect(recovery).toContain('INTEL_PUBLICATION_RECOVERY_MAX_ATTEMPTS');
    expect(recovery).toContain('AND updated_at=$6');
    expect(recovery).toContain('last_recovery_attempt_at');
    expect(recovery).toMatch(/LIMIT \$4`,\s*\[orgId,now,staleMinutes,limit,maxAttempts\]\s*\)\);/);
    expect(recovery).toContain('await withOrg(orgId,client=>client.query(');
    expect(recovery).not.toContain('await query(');
  });

  test('successful and zero-incident research clears obsolete recovery failures', () => {
    const previous = {
      recovery_attempts: 2,
      recovery_max_attempts: 3,
      last_failure_reason: 'previous provider outage',
      next_attempt_at: '2026-10-09T09:00:00.000Z',
    };
    const successful = publicationRecoveryMetadata({
      priorResearch: previous,
      researchSummary: { researched: 2, researched_limited: 1 },
      expectedResearchCount: 3,
      researchAttempted: true,
      now: new Date('2026-10-09T08:00:00.000Z'),
      cooldownMinutes: 60,
      maxAttempts: 3,
    });
    expect(successful.last_failure_reason).toBeNull();
    expect(successful.next_attempt_at).toBeNull();
    expect(successful.recovery_exhausted).toBe(false);
    expect(publicationRecoveryMetadata({
      priorResearch: previous, researchSummary: { researched: 0 },
      expectedResearchCount: 0, researchAttempted: false,
      now: new Date('2026-10-09T08:00:00.000Z'), maxAttempts: 3,
    })).toMatchObject({ last_failure_reason: null, next_attempt_at: null, recovery_exhausted: false });
  });

  test('unavailable research is scheduled with a bounded cooldown and stops at the attempt limit', () => {
    const state = publicationRecoveryMetadata({
      priorResearch: { recovery_attempts: 3, recovery_max_attempts: 3 },
      researchSummary: { researched: 0, researched_limited: 0 },
      expectedResearchCount: 4,
      researchAttempted: true,
      now: new Date('2026-10-09T08:00:00.000Z'),
      cooldownMinutes: 60,
      maxAttempts: 3,
    });
    expect(state.last_failure_reason).toContain('evidence-only');
    expect(state.next_attempt_at).toBe('2026-10-09T09:00:00.000Z');
    expect(state.recovery_attempts).toBe(3);
    expect(state.recovery_max_attempts).toBe(3);
    expect(state.recovery_exhausted).toBe(true);
  });

  test('provider readiness status respects active cooldown and publication data policy', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/utils/intelligenceAgents.js'), 'utf8');
    expect(source).toContain("if(aiBoardEnabled && aiBoardStatus==='disabled')aiBoardStatus=publicationAiReady?'not_run':'provider_unavailable';");
  });
});
