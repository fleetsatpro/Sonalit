const fs=require('fs');
const path=require('path');
const source=()=>fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');
const {publicationRecoveryMetadata}=require('../src/utils/publicationRecoveryMetadata');

describe('publication research retry hardening',()=>{

  test('new source-quality contract invalidates older stored research dossiers',()=>{
    const s=source();
    expect(s).toContain("const DEEP_RESEARCH_VERSION='2.2'");
    expect(s).toContain('gdelt_requests=');
  });

  test('fallback incidents do not satisfy deep-research completion',()=>{
    const s=source();
    expect(s).toContain("const previousResearchCount=Number(priorResearch.incidents_web_researched||0);");
    expect(s).not.toContain("Number(priorResearch.incidents_web_researched||0)+Number(priorResearch.incidents_fallback||0)");
  });

  test('failed research is retry-rate-limited but evidence changes force a new attempt',()=>{
    const s=source();
    expect(s).toContain('researchCooldownMinutes');
    expect(s).toContain('researchAttemptRecent');
    expect(s).toContain('(!researchAttemptRecent||evidenceChanged||researchVersionMismatch||publicationPolicyMismatch||Boolean(options.forceResearch))');
    expect(s).toContain('skipped_due_to_cooldown');
  });

  test('previous successful incident dossiers survive a fallback only when evidence is unchanged',()=>{
    const s=source();
    expect(s).toContain('if(!evidenceChanged){');
    expect(s).toContain("current?.agent?.status==='fallback'&&prior?.agent?.status==='researched'");
    expect(s).toContain('else if(!current&&prior)effectiveResearchByEvent[id]=prior;');
  });

  test('research attempt timing and next retry are persisted using the active execution clock',()=>{
    const s=source();
    expect(s).toContain('last_attempt_at:researchAttempted?now.toISOString()');
    expect(s).toContain('...publicationRecoveryMetadata({');
    expect(s).toContain('cooldownMinutes:researchCooldownMinutes');
    const state=publicationRecoveryMetadata({
      priorResearch:{recovery_attempts:1},
      researchSummary:{researched:1,researched_limited:0},
      expectedResearchCount:2,
      researchAttempted:true,
      now:new Date('2026-10-09T08:00:00.000Z'),
      cooldownMinutes:60,
      maxAttempts:3
    });
    expect(state.last_failure_reason).toContain('evidence-only');
    expect(state.next_attempt_at).toBe('2026-10-09T09:00:00.000Z');
    expect(state.recovery_attempts).toBe(1);
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
