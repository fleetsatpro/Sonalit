const fs = require('fs');
const path = require('path');

describe('publication generation deduplication hardening',()=>{
  test('publication generation runs inside one tenant transaction with a PostgreSQL advisory lock',()=>{
    const source=fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');
    expect(source).toContain('async function publicationForCountryUnsafe');
    expect(source).toContain('function publicationForCountry(orgId,country,type=\'daily\')');
    expect(source).toContain('pg_advisory_xact_lock');
    expect(source).toContain('return withOrg(orgId, async client => {');
  });
  test('publication change detection is content-based rather than count-only',()=>{
    const source=fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');
    expect(source).toContain('function publicationFingerprint(country,type,start,end,events)');
    expect(source).toContain('headline:e.headline,brief:e.brief');
    expect(source).not.toContain('id:e.id,updated_at:e.updated_at,last_seen_at:e.last_seen_at');
    expect(source).toContain('fingerprint');
    expect(source).toContain("const evidenceChanged=String(priorCoverage.fingerprint||'')!==fingerprint;");
  });
  test('forces one refresh when the research contract version changes',()=>{
    const source=fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');
    expect(source).toContain("const DEEP_RESEARCH_VERSION='2.0'");
    expect(source).toContain("String(priorResearch.research_version||'')!==DEEP_RESEARCH_VERSION");
    expect(source).toContain("Number(priorResearch.incidents_web_researched||0)");
  });
  test('database schema retains historical duplicates but enforces one active publication per period',()=>{
    const files=fs.readdirSync(path.join(__dirname,'../migrations')).filter(name=>name.includes('intelligence_publication_dedupe'));
    expect(files.length).toBe(1);
    const source=fs.readFileSync(path.join(__dirname,'../migrations',files[0]),'utf8');
    expect(source).toContain('CREATE UNIQUE INDEX');
    expect(source).toContain("status IN ('draft','review','published')");
    expect(source).toContain('status=\'superseded\'');
  });
});


test('AI editorial board is mandatory publication authority by default',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');
  expect(source).toContain("const aiBoardEnabled=String(process.env.INTEL_PUBLICATION_AI_BOARD||'true').toLowerCase()!=='false';");
  expect(source).toContain("const aiBoardRequired=String(process.env.INTEL_PUBLICATION_AI_BOARD_REQUIRED||'true').toLowerCase()!=='false';");
  expect(source).toContain('const aiBoardGate=events.length===0 ? true : (aiBoardRequired ? boardPublishable : true);');
  expect(source).toContain('researchReleaseGate');
  expect(source).not.toContain('deterministic evidence product remains eligible');
});


test('publication agent imports the editorial quality audit before invoking it',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');
  expect(source).toMatch(/const \{ auditPublicationContent(?:, assessPublicationQuality)?, isAggregatorDomain, normalizeDomain, sourceIsSubstantive(?:, isRepetitiveTemplateText)? \} = require\('\.\/publicationQuality'\);/);
  expect(source).toContain('const finalQuality=auditPublicationContent(');
});


test('AI provider clients have bounded request time and no nested SDK retries',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/utils/aiClient.js'),'utf8');
  expect(source).toContain('AI_REQUEST_TIMEOUT_MS');
  expect(source).toContain('maxRetries: 0');
  expect(source).toContain('timeout: AI_REQUEST_TIMEOUT_MS');
});


test('publication evidence policy accepts only defensible direct non-aggregator research',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');
  expect(source).toContain("const PUBLICATION_EVIDENCE_VERSION='1.1';");
  expect(source).toContain("basis:researchContract?'DIRECT_WEB_RESEARCH':'INSUFFICIENT_EVIDENCE'");
  expect(source).toContain('uniqueUrls.size>=2 && uniqueDomains.size>=2');
  expect(source).toContain('!isAggregatorDomain(domain)');
  expect(source).toContain('const verifiedPages=Array.isArray(packet?.packet?.fetched_pages)');
  expect(source).toContain('filter(sourceIsSubstantive)');
  const builder=fs.readFileSync(path.join(__dirname,'../src/utils/intelligencePublicationBuilder.js'),'utf8');
  expect(builder).toContain("Publication basis satisfies the configured evidence-source threshold.");
  expect(source).toContain("const status=(publicationEvidenceContract&&qualityGate&&aiBoardGate&&researchReleaseGate)?'published':'draft';");
});


test('publication evidence basis is synchronous because it is consumed without await',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');
  expect(source).toContain('function publicationEvidenceBasis(originalEvidenceContract, research, publicationEvents, allEvents){');
  expect(source).not.toContain('async function publicationEvidenceBasis(originalEvidenceContract, research, publicationEvents){');
});
