const fs = require('fs');
const path = require('path');

describe('publication generation deduplication hardening',()=>{
  test('publication generation runs inside one tenant transaction with a PostgreSQL advisory lock',()=>{
    const source=fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');
    expect(source).toContain('async function publicationForCountryUnsafe');
    expect(source).toContain('async function publicationForCountry(orgId,country,type=\'daily\')');
    expect(source).toContain('pg_advisory_xact_lock');
    expect(source).toContain('return withOrg(orgId, async client => {');
  });
  test('publication change detection is content-based rather than count-only',()=>{
    const source=fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');
    expect(source).toContain('function publicationFingerprint(country,type,start,end,events)');
    expect(source).toContain('headline:e.headline,brief:e.brief');
    expect(source).not.toContain('id:e.id,updated_at:e.updated_at,last_seen_at:e.last_seen_at');
    expect(source).toContain('fingerprint');
    expect(source).toContain("String(priorCoverage.fingerprint||'')===fingerprint");
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


test('AI editorial board is optional resilience enrichment, not a publication blocker by default',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');
  expect(source).toContain("const aiBoardEnabled=String(process.env.INTEL_PUBLICATION_AI_BOARD||'').toLowerCase()==='true';");
  expect(source).toContain("const aiBoardRequired=String(process.env.INTEL_PUBLICATION_AI_BOARD_REQUIRED||'').toLowerCase()==='true';");
  expect(source).toContain('const aiBoardGate=aiBoardRequired ? boardPublishable : true;');
  expect(source).toContain('deterministic evidence product remains eligible');
});
