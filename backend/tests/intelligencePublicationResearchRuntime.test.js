const fs=require('fs');
const path=require('path');
const source=()=>fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');

describe('publication deep-research runtime ordering',()=>{
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

test('stored publication_quality is the final tradecraft assessment, not the legacy deterministic score',()=>{
  const s=source();
  expect(s).toContain('publication_quality:finalBody.publication_quality||null');
  expect(s).not.toContain('publication_quality:deterministic.publication_quality||null');
});

test('publication runtime imports the tradecraft quality gate it invokes',()=>{
  const s=source();
  expect(s).toContain("assessPublicationQuality,");
  expect(s).toContain('const tradecraftQuality=assessPublicationQuality(finalBody);');
});

test('senior editor must return the incident dossiers rendered by the PDF',()=>{
  const boardSource=fs.readFileSync(path.join(__dirname,'../src/utils/intelligencePublicationEditorialBoard.js'),'utf8');
  expect(boardSource).toContain('Required keys: title,subtitle,executive_assessment,sections,outlook,incident_dossiers');
  expect(boardSource).toContain('const finalDossiers=Array.isArray(final?.incident_dossiers)?final.incident_dossiers:[];');
  expect(boardSource).toContain('finalDossiersComplete');
});

test('release gate evaluates the effective reused research dossiers',()=>{
  const s=source();
  expect(s).toContain('effectiveResearchByEvent[String(e.id)]?.agent?.status');
  expect(s).not.toContain('incidentResearch.summary.researched>=expectedResearchCount && Number(incidentResearch.summary.researched_limited||0)===0');
});

test('changed evidence forces a fresh research attempt even when prior coverage was complete',()=>{
  const s=source();
  expect(s).toContain('const needsDeepResearch=deepResearchEnabled&&expectedResearchCount>0&&(!priorDossierResearchReady||previousResearchCount<expectedResearchCount||researchVersionMismatch||evidenceChanged)');
  expect(s).toContain('&&(!researchAttemptRecent||evidenceChanged)');
  expect(s).toContain('if(!evidenceChanged){');
});

test('editorial board is enabled and required by default',()=>{
  const s=source();
  expect(s).toContain("process.env.INTEL_PUBLICATION_AI_BOARD||'true'");
  expect(s).toContain("process.env.INTEL_PUBLICATION_AI_BOARD_REQUIRED||'true'");
});


test('editorial board requires exact incident-id coverage in the final report',()=>{
  const boardSource=fs.readFileSync(path.join(__dirname,'../src/utils/intelligencePublicationEditorialBoard.js'),'utf8');
  expect(boardSource).toContain('const expectedEventIds=new Set(events.map(e=>String(e.id)));');
  expect(boardSource).toContain('returnedEventIds.size===expectedEventIds.size');
  expect(boardSource).toContain('[...expectedEventIds].every(id=>returnedEventIds.has(id))');
});


test('senior-editor output cannot replace verified research provenance fields',()=>{
  const s=source();
  expect(s).toContain('research_status:verifiedResearch.status||d?.research_status||null');
  expect(s).toContain('research_provider:verifiedResearch.provider||d?.research_provider||null');
  expect(s).toContain('research_method:verifiedResearch.research_method||d?.research_method||null');
  expect(s).toContain('research_sources:Array.isArray(verifiedResearch.sources)?verifiedResearch.sources.map(src=>({...src}))');
});


test('limited prior research forces another research attempt after cooldown',()=>{
  const s=source();
  expect(s).toContain('const priorDossierResearchReady=expectedResearchCount===0 || publicationEvents.every');
  expect(s).toContain('(!priorDossierResearchReady||previousResearchCount<expectedResearchCount||researchVersionMismatch||evidenceChanged)');
  expect(s).toContain('const priorResearchReleaseReady=!publicationResearchRequired || priorDossierResearchReady;');
});
