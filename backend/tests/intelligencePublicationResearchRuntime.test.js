const fs=require('fs');
const path=require('path');
const source=()=>fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');

describe('publication deep-research runtime ordering',()=>{
  test('defines the publication incident set before invoking research',()=>{
    const s=source();
    const subset=s.indexOf('const publicationEvents=selectPublicationResearchEvents(events,researchLimit);');
    const research=s.indexOf('researchPublicationIncidents(publicationEvents',{});
    expect(subset).toBeGreaterThan(-1);
    expect(s).toContain("const researchLimit=type==='daily'");
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
  expect(s).toContain('const needsDeepResearch=');
  expect(s).toContain('Boolean(options.forceResearch)');
  expect(s).toContain('researchAttemptRecent');
  expect(s).toContain('if(!evidenceChanged){');
});

test('editorial board is enabled and required by default',()=>{
  const s=source();
  expect(s).toContain("process.env.INTEL_PUBLICATION_AI_BOARD||'true'");
  expect(s).toContain("process.env.INTEL_PUBLICATION_AI_BOARD_REQUIRED||'true'");
});


test('publication QA lanes may use free open-weight models when the publication is explicitly public',()=>{
  const boardSource=fs.readFileSync(path.join(__dirname,'../src/utils/intelligencePublicationEditorialBoard.js'),'utf8');
  expect(boardSource).toContain("id:'publication-qa', lane:'qa'");
  expect(boardSource).toContain("id:'independent-quality-assurance', lane:'qa'");
  expect(boardSource).toContain("id:'release-integrity-auditor', lane:'qa'");
  expect(boardSource).toContain("allowFreeProviders:true");
  expect(boardSource).toContain("preferFreeProviders:true");
  expect(boardSource).toContain("dataClassification:String(process.env.INTEL_PUBLICATION_DATA_CLASSIFICATION||'public').toLowerCase()");
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
  expect(s).toContain('const needsDeepResearch=');
  expect(s).toContain('Boolean(options.forceResearch)');
  expect(s).toContain('researchAttemptRecent');
  expect(s).toContain('const priorResearchReleaseReady=!publicationResearchRequired || priorDossierResearchReady;');
});

test('research collection cools GDELT after rate limiting instead of retrying every incident',()=>{
  const s=fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceIncidentResearch.js'),'utf8');
  expect(s).toContain('const GDELT_COOLDOWN_MS=5*60*1000;');
  expect(s).toContain('let gdeltDownUntil=0;');
  expect(s).toContain('if(Date.now()<gdeltDownUntil)return [];');
  expect(s).toContain("gdeltDownUntil=Date.now()+GDELT_COOLDOWN_MS");
});

test('preferred free research does not probe an unavailable paid rescue lane first',()=>{
  const s=fs.readFileSync(path.join(__dirname,'../src/utils/aiClient.js'),'utf8');
  expect(s).toContain('if(hasAnthropic() && !params.preferFreeProviders)');
});


test('incident research can still build a live web packet when no AI provider is ready',()=>{
  const s=source();
  expect(s).toContain('if(deepResearchEnabled&&expectedResearchCount>0&&needsDeepResearch){');
  expect(s).not.toContain('needsDeepResearch&&publicationAiReady');
  expect(s).toContain("['researched','researched_limited'].includes");
});

test('limited research is considered release-complete but remains subject to the tradecraft gate',()=>{
  const s=source();
  expect(s).toContain("['researched','researched_limited'].includes(String(dossier?.research_status||'').toLowerCase())");
  expect(s).toContain('const needsDeepResearch=');
  expect(s).toContain('Boolean(options.forceResearch)');
  expect(s).toContain('researchAttemptRecent');
});


test('degraded incident research does not halt remaining incidents when AI is unavailable',()=>{
  const s=fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceIncidentResearch.js'),'utf8');
  expect(s).toContain('const results=await researchBatch(batch,{country,region});');
  expect(s).not.toContain("halted=true;");
  expect(s).not.toContain('remaining incidents deferred');
});


test('OpenAI readiness must reflect per-key cooldown state rather than configuration alone',()=>{
  const s=fs.readFileSync(path.join(__dirname,'../src/utils/aiClient.js'),'utf8');
  expect(s).toContain('function hasReadyOpenAIKey()');
  expect(s).toContain("provider.name==='openai-direct' ? hasReadyOpenAIKey() :");
  expect(s).toContain("provider.name===GEMINI_PROVIDER.name ? hasReadyGeminiKey() :");
});

test('editorial board accepts controlled limited incident research',()=>{
  const s=fs.readFileSync(path.join(__dirname,'../src/utils/intelligencePublicationEditorialBoard.js'),'utf8');
  expect(s).toContain("['researched','researched_limited'].includes(String(e?.research?.agent?.status||'').toLowerCase())");
});


test('editorial board provider outage is classified as provider_unavailable rather than a generic hold',()=>{
  const src=fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');
  expect(src).toContain("result?.qaConsensus?.blocking_issues");
  expect(src).toContain("aiBoardStatus=boardProviderUnavailable?'provider_unavailable'");
});


test('publication research records degraded evidence eligibility explicitly',()=>{
  const s=fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceIncidentResearch.js'),'utf8');
  expect(s).toContain('degradedEvidenceEligible=values.filter');
  expect(s).toContain('degraded_evidence_eligible:degradedEvidenceEligible');
});


test('incident publication uses the actual research outcome instead of stale provider readiness',()=>{
  const s=source();
  expect(s).toContain("const priorEvidenceConstrained=");
  expect(s).toContain("entry.error==='ai_provider_unavailable'");
  expect(s).toContain('const allSelectedIncidentsDegraded=');
  expect(s).toContain('const publicationEvidenceContract=events.length===0 || evidenceContract || publicationBasis.publishable || allSelectedIncidentsDegraded;');
  expect(s).toContain('const degradedEvidenceRelease=');
  expect(s).toContain('if(aiBoardEnabled && publicationAiAvailable && events.length && !degradedEvidenceRelease)');
  expect(s).toContain("const publicationAiAvailable=typeof aiClient.hasAnyProvider==='function' && aiClient.hasAnyProvider(publicationAiPolicy);");
  expect(s).toContain('degradedEvidenceRelease || !publicationAiAvailable');
});


test('degraded fallback narrative is built from incident evidence, assessment, relevance and uncertainty',()=>{
  const s=fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceIncidentResearch.js'),'utf8');
  expect(s).toContain("'Operational assessment: '+derivedAssessment");
  expect(s).toContain("'Decision relevance: '+why[0]");
  expect(s).toContain("'Research state: evidence-constrained; this edition does not present unverified detail as fact.'");
});


test('degraded evidence eligibility requires attribution but not per-incident dual-source corroboration',()=>{
  const s=fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceIncidentResearch.js'),'utf8');
  expect(s).toContain('eventEvidence.length>=1 && eventEvidenceSources.size>=1');
  expect(s).not.toContain('eventEvidence.length>=2 && eventEvidenceSources.size>=2');
});


test('fallback evidence is initialized before narrative construction',()=>{
  const s=fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceIncidentResearch.js'),'utf8');
  expect(s).toContain('const eventEvidence=Array.isArray(event?.evidence)?event.evidence:[];');
  expect(s.indexOf('const eventEvidence=Array.isArray(event?.evidence)?event.evidence:[];')).toBeLessThan(s.indexOf('const narrative=cleanPublicationText('));
});
