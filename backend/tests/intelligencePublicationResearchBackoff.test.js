const fs=require('fs');
const path=require('path');

describe('publication research retry hardening',()=>{
  const source=()=>fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');
  test('fallback incidents do not satisfy deep-research completion',()=>{
    const s=source();
    expect(s).toContain("const previousResearchCount=Number(priorResearch.incidents_researched||0);");
    expect(s).not.toContain("Number(priorResearch.incidents_researched||0)+Number(priorResearch.incidents_fallback||0)");
  });
  test('failed research retries are rate-limited but evidence changes force a new attempt',()=>{
    const s=source();
    expect(s).toContain('researchCooldownMinutes');
    expect(s).toContain('researchAttemptRecent');
    expect(s).toContain('(!researchAttemptRecent||evidenceChanged)');
    expect(s).toContain('skipped_due_to_cooldown');
  });
  test('prior researched incident dossiers are preserved during transient provider failure',()=>{
    const s=source();
    expect(s).toContain("current?.agent?.status==='fallback'&&prior?.agent?.status==='researched'");
    expect(s).toContain("else if(!current&&prior) effectiveResearchByEvent[id]=prior;");
  });
});
