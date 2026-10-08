const { buildEvidencePublication } = require('../src/utils/intelligencePublicationBuilder');

describe('evidence-first intelligence publication builder',()=>{
  const base={
    id:'event-1',
    headline:'Road closure reported after armed attack',
    brief:'A road section was reportedly disrupted after an armed attack.',
    severity:'high',
    confidence:82,
    intelligence_type:'SECURITY',
    latitude:-1.28,
    longitude:36.82,
    region:'NAIROBI',
    risk_velocity:0.4,
    assessment:{judgement:'The disruption could increase exposure on the affected corridor if persistence is confirmed.'},
    key_facts:['A road section was reportedly disrupted after an armed attack.','Two distinct sources are linked to the event.'],
    why_it_matters:['The disruption warrants review of route exposure and continuity measures.'],
    caveats:['The event record does not establish completeness of reporting.'],
    synthesis_confidence:82,
    synthesis_provider:'evidence-fallback',
    observation_count:2,
    source_count:2,
    evidence:[
      {id:'obs-1',source_id:'src-1',source_name:'BBC World',title:'Road closure reported after attack',url:'https://example.com/1'},
      {id:'obs-2',source_id:'src-2',source_name:'UN News',title:'Transport disruption reported',url:'https://example.com/2'}
    ]
  };
  test('builds the sample-style intelligence product structure without AI',()=>{
    const start=new Date('2026-10-01T00:00:00.000Z');
    const end=new Date('2026-10-08T00:00:00.000Z');
    const body=buildEvidencePublication({
      country:'KE',type:'weekly',start,end,events:[base, {...base,id:'event-2',headline:'Demonstration reported',intelligence_type:'POLITICAL',severity:'moderate'}],
      evidenceCount:4,sourceCount:2,evidenceContract:true
    });
    expect(body.title).toMatch(/Kenya Weekly Security Intelligence/);
    expect(body.executive_assessment).toContain('Kenya recorded 2');
    expect(body.key_developments.length).toBe(2);
    expect(body.assessment_highlights[0]).toHaveProperty('judgement');
    expect(body.assessment_highlights[0].judgement).toContain('disruption could increase exposure');
    expect(body.regional_news[0].region).toBe('NAIROBI');
    expect(body.pmesi).toHaveLength(5);
    expect(body.incident_map.points.length).toBe(2);
    expect(body.regional_news[0].items[0].brief).toBeUndefined();
    expect(body.regional_news[0].items[0].what_happened).toBeUndefined();
    expect(body.pmesi[0].update).not.toContain(base.brief);
    expect(body.references).toHaveLength(2);
    expect(body.collection_coverage.evidence_contract_met).toBe(true);
    expect(body.public_safety_security_overview.indicators).toHaveLength(4);
    expect(body.emerging_trends.length).toBeGreaterThan(0);
    expect(body.emerging_trends[0].basis).toBe('CURRENT_PERIOD_CONCENTRATION');
    expect(body.emerging_trends[0].assessment).toContain('not a time-series trend');
    expect(body.pmesi.find(x=>x.domain==='INFORMATION & MEDIA').update).toBeNull();
    expect(body.key_drivers.length).toBeGreaterThan(0);
    expect(body.key_findings_assessment.findings.length).toBe(2);
  });
  test('uses detailed humanized incident research when attached',()=>{
    const start=new Date('2026-10-01T00:00:00.000Z');
    const end=new Date('2026-10-02T00:00:00.000Z');
    const researched={
      ...base,
      research:{
        agent:{
          status:'researched',
          narrative:'The disruption began after armed actors were reported near the corridor. Local reporting and the linked source record describe a temporary break in road movement, while the available evidence does not establish how long the interruption lasted or whether the threat moved beyond the immediate area.',
          context:'The incident matters because the affected corridor supports routine road movement and any prolonged closure can create knock-on delays for commercial traffic.',
          confirmed_facts:['Movement was disrupted on the reported road section.','Two independent source records are linked to the event.'],
          reported_or_disputed:['The duration of the disruption remains unclear.'],
          analytical_assessment:'The evidence supports a short-term access risk, but does not yet justify a broader deterioration judgement.',
          why_it_matters:['The event could increase delay and exposure for vehicles using the corridor.'],
          uncertainty:['The available reporting does not establish the full duration or geographic extent of the disruption.'],
          chronology:[{time:'01 Oct 2026 09:00 UTC',event:'Initial disruption reported.'}],
          sources:[{title:'BBC report',url:'https://example.com/bbc',domain:'bbc.com'}],
          provider:'anthropic-web-search'
        }
      }
    };
    const body=buildEvidencePublication({country:'KE',type:'daily',start,end,events:[researched],evidenceCount:2,sourceCount:2,evidenceContract:true});
    expect(body.key_developments[0].assessment).toContain('short-term access risk');
    expect(body.key_developments[0].significance).toContain('delay and exposure');
    expect(body.incident_dossiers[0].research_status).toBe('researched');
    expect(body.incident_dossiers[0].what_happened).toContain('The disruption began after armed actors');
    expect(body.incident_dossiers[0].context).toContain('affected corridor');
    expect(body.incident_dossiers[0].research_sources[0].domain).toBe('bbc.com');
    expect(body.incident_dossiers[0].chronology[0].time).toContain('01 Oct 2026');
  });
  test('explicitly states when there is no event evidence rather than inventing incidents',()=>{
    const body=buildEvidencePublication({
      country:'SO',type:'daily',start:new Date('2026-10-04T00:00:00.000Z'),end:new Date('2026-10-05T00:00:00.000Z'),
      events:[],evidenceCount:0,sourceCount:0,evidenceContract:false
    });
    expect(body.executive_assessment).toMatch(/No security-relevant event objects were recorded/);
    expect(body.key_developments).toEqual([]);
    expect(body.references).toEqual([]);
    expect(body.collection_coverage.evidence_contract_met).toBe(false);
  });
});