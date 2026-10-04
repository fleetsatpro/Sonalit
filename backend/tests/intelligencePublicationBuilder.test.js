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
    expect(body.title).toMatch(/Kenya Weekly Insight/);
    expect(body.executive_assessment).toContain('Kenya recorded 2');
    expect(body.key_developments.length).toBe(2);
    expect(body.regional_news[0].region).toBe('NAIROBI');
    expect(body.pmesi).toHaveLength(5);
    expect(body.incident_map.points.length).toBe(2);
    expect(body.references).toHaveLength(2);
    expect(body.collection_coverage.evidence_contract_met).toBe(true);
    expect(body.public_safety_security_overview.indicators).toHaveLength(4);
    expect(body.emerging_trends.length).toBeGreaterThan(0);
    expect(body.key_drivers.length).toBeGreaterThan(0);
    expect(body.key_findings_assessment.findings.length).toBe(2);
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