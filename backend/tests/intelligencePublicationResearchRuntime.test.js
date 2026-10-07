const fs=require('fs');
const path=require('path');

describe('publication deep-research runtime ordering',()=>{
  const source=()=>fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');
  test('defines the publication incident set before invoking research',()=>{
    const s=source();
    const subset=s.indexOf('const publicationEvents=selectPublicationResearchEvents(events,8);');
    const research=s.indexOf('researchPublicationIncidents(publicationEvents',{});
    expect(subset).toBeGreaterThan(-1);
    expect(research).toBeGreaterThan(subset);
  });
  test('legacy publications without complete research are not returned as unchanged',()=>{
    const s=source();
    const needs=s.indexOf('const needsDeepResearch=');
    const unchanged=s.indexOf('const unchanged=');
    const early=s.indexOf("if(existing.length&&unchanged)return");
    expect(needs).toBeGreaterThan(-1);
    expect(unchanged).toBeGreaterThan(needs);
    expect(early).toBeGreaterThan(unchanged);
    expect(s.slice(unchanged,early)).toContain('&& !needsDeepResearch');
  });
  test('research telemetry exposes web-search request count',()=>{
    const s=source();
    expect(s).toContain('web_search_requests=');
  });
});


test('publication release defaults to requiring complete incident research',()=>{
  const s=source();
  expect(s).toContain("process.env.INTEL_PUBLICATION_REQUIRE_RESEARCH||'true'");
  expect(s).toContain('researchReleaseGate');
  expect(s).toContain('tradecraftQuality');
  expect(s).toContain('publication_research_required:publicationResearchRequired');
});

test('AI senior-editor output is allowed to override deterministic prose fields',()=>{
  const s=source();
  const merge=s.indexOf('finalBody={...deterministic,...final');
  expect(merge).toBeGreaterThan(-1);
});

test('release gate evaluates the effective reused research dossiers',()=>{
  const s=source();
  expect(s).toContain('effectiveResearchByEvent[String(e.id)]?.agent?.status');
  expect(s).not.toContain('incidentResearch.summary.researched>=expectedResearchCount && Number(incidentResearch.summary.researched_limited||0)===0');
});

test('editorial board is enabled and required by default',()=>{
  const s=source();
  expect(s).toContain("process.env.INTEL_PUBLICATION_AI_BOARD||'true'");
  expect(s).toContain("process.env.INTEL_PUBLICATION_AI_BOARD_REQUIRED||'true'");
});
