const fs=require('fs');
const path=require('path');
const source=()=>fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');

describe('publication research retry hardening',()=>{

  test('fallback incidents do not satisfy deep-research completion',()=>{
    const s=source();
    expect(s).toContain("const previousResearchCount=Number(priorResearch.incidents_web_researched||0);");
    expect(s).not.toContain("Number(priorResearch.incidents_web_researched||0)+Number(priorResearch.incidents_fallback||0)");
  });

  test('failed research is retry-rate-limited but evidence changes force a new attempt',()=>{
    const s=source();
    expect(s).toContain('researchCooldownMinutes');
    expect(s).toContain('researchAttemptRecent');
    expect(s).toContain('(!researchAttemptRecent||evidenceChanged||Boolean(options.forceResearch))');
    expect(s).toContain('skipped_due_to_cooldown');
  });

  test('previous successful incident dossiers survive a fallback only when evidence is unchanged',()=>{
    const s=source();
    expect(s).toContain('if(!evidenceChanged){');
    expect(s).toContain("current?.agent?.status==='fallback'&&prior?.agent?.status==='researched'");
    expect(s).toContain('else if(!current&&prior)effectiveResearchByEvent[id]=prior;');
  });

  test('research attempt timing is persisted in publication metadata',()=>{
    const s=source();
    expect(s).toContain('last_attempt_at:researchAttempted?now.toISOString()');
    expect(s).toContain('next_attempt_at:researchAttempted&&incidentResearch.summary.researched<expectedResearchCount');
    expect(s).toContain('retry_cooldown_minutes:researchCooldownMinutes');
  });
});


test('downgrading a published product invalidates its cached PDF',()=>{
  const s=source();
  const blockStart=s.indexOf('if(refreshPdf){');
  expect(blockStart).toBeGreaterThan(-1);
  expect(s.slice(blockStart,blockStart+520)).toContain("pdf_status='not_requested'");
  expect(s.slice(blockStart,blockStart+520)).toContain("pdf_key=NULL");
  expect(s.slice(blockStart,blockStart+520)).toContain("pdf_url=NULL");
});
