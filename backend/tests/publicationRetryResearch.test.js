'use strict';

const fs = require('fs');
const path = require('path');

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

  test('provider readiness status respects active cooldown and publication data policy', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/utils/intelligenceAgents.js'), 'utf8');
    expect(source).toContain("if(aiBoardEnabled && aiBoardStatus==='disabled')aiBoardStatus=publicationAiReady?'not_run':'provider_unavailable';");
  });
});
