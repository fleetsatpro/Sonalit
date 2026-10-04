const {
  cleanPublicationText,
  dedupeSentences,
  uniqueStrings,
  dedupeSources,
  isAggregatorDomain,
  repetitionRatio
}=require('../src/utils/publicationQuality');

describe('publication content quality controls',()=>{
  test('removes known Google News and legacy boilerplate without damaging incident prose',()=>{
    const value=cleanPublicationText(
      'The incident affected the corridor. Comprehensive up-to-date news coverage, aggregated from sources all over the world by Google News. The duration remains unclear.'
    );
    expect(value).toBe('The incident affected the corridor. The duration remains unclear.');
  });

  test('deduplicates semantically identical sentences',()=>{
    const seen=new Set();
    const value=dedupeSentences(
      'Movement was disrupted on the corridor. Movement was disrupted on the corridor. Authorities responded to the disruption.',
      seen
    );
    expect(value).toMatch(/Movement was disrupted on the corridor\./);
    expect(value).toMatch(/Authorities responded to the disruption\./);
    expect((value.match(/Movement was disrupted on the corridor/gi)||[]).length).toBe(1);
    expect(repetitionRatio(value)).toBe(0);
  });

  test('removes aggregator sources and duplicate stories while preserving distinct domains',()=>{
    const sources=dedupeSources([
      {url:'https://news.google.com/articles/x',domain:'news.google.com',title:'Same story'},
      {url:'https://example.com/a',domain:'example.com',title:'Road closure after attack'},
      {url:'https://example.com/b',domain:'example.com',title:'Road closure after attack - update'},
      {url:'https://un.example/report',domain:'un.example',title:'Transport disruption'},
      {url:'https://another.example/report',domain:'another.example',title:'Independent confirmation'}
    ]);
    expect(isAggregatorDomain('news.google.com')).toBe(true);
    expect(sources.some(x=>x.domain==='news.google.com')).toBe(false);
    expect(sources).toHaveLength(3);
    expect(new Set(sources.map(x=>x.domain)).size).toBe(3);
  });

  test('normalizes unique lists without repeated boilerplate',()=>{
    expect(uniqueStrings([
      'The event remains bounded by the evidence recorded in Sonalit.',
      'The event remains bounded by the evidence recorded in Sonalit.',
      'The affected corridor supports commercial movement.'
    ])).toEqual(['The affected corridor supports commercial movement.']);
  });
});
