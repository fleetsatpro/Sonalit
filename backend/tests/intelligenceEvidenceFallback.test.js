const { evidenceDerivedSynthesis } = require('../src/utils/intelligenceAgents');

describe('Intelligence evidence fallback',()=>{
  test('derives a bounded publication-safe synthesis from stored evidence',()=>{
    const result=evidenceDerivedSynthesis({
      id:'event-1',
      title:'Road closure reported after armed attack',
      summary:'A reported road disruption was observed in the supplied evidence.',
      confidence:77,
      evidence:[
        {source:'BBC World',title:'Road closure reported after attack'},
        {source:'UN News',title:'Regional transport disruption'}
      ]
    });
    expect(result).toMatchObject({
      id:'event-1',
      headline:'Road closure reported after armed attack',
      intelligence_type:'SECURITY',
      confidence:77
    });
    expect(result.key_facts).toEqual([
      'BBC World: Road closure reported after attack',
      'UN News: Regional transport disruption'
    ]);
    expect(result.caveats[0]).toContain('Evidence coverage is limited to the sources linked to this event in Sonalit.');
    expect(result.caveats[0]).not.toContain('Automated AI synthesis unavailable');
    expect(result.why_it_matters[0]).toContain('Road closure reported after armed attack');
  });
});
