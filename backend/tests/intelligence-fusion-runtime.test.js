'use strict';

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/utils/intelligenceExtendedProviders', () => ({ buildExtendedAdapters: jest.fn(() => []) }));

const { query } = require('../src/config/database');
const { fuseOrg } = require('../src/utils/intelligenceFusionRuntime');

const ORG = '00000000-0000-0000-0000-000000000001';
const EVENT = '00000000-0000-0000-0000-000000000002';
const OBS = '00000000-0000-0000-0000-000000000003';

describe('intelligence fused-event persistence contract', () => {
  beforeEach(() => query.mockReset());

  test('applies impact-based severity and caps confidence by independent publisher count',()=>{
    const {severityFor,confidenceFor,sourceKey}=require('../src/utils/intelligenceFusionRuntime');
    expect(severityFor('Peaceful protest held in Nairobi')).toBe('low');
    expect(severityFor('Routine traffic congestion on the highway')).toBe('low');
    expect(severityFor('Ongoing armed attack reported near town')).toBe('high');
    expect(severityFor('Terrorist attack with at least 8 people killed')).toBe('critical');
    const observations=[{reliability:95,observed_at:new Date().toISOString(),source_id:'a'}];
    expect(confidenceFor(observations,1,0)).toBeLessThanOrEqual(45);
    expect(sourceKey({provider:'newsmesh',source_id:'a',raw_metadata:{aggregator_source:'The Star'}})).toBe('the star');
    expect(sourceKey({provider:'newsmesh',source_id:'b',raw_metadata:{aggregator_source:'The Star'}})).toBe('the star');
    expect(sourceKey({provider:'newsmesh',source_id:'feed-1',url:'https://www.example-news.test/story/one'})).toBe('example-news.test');
    expect(sourceKey({provider:'newsmesh',source_id:'feed-2',url:'https://example-news.test/story/two'})).toBe('example-news.test');
  });
  test('excludes unrelated observations from corroboration and event evidence',async()=>{
    const observedAt=new Date().toISOString();
    query.mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[
        {id:OBS,source_id:'feed-security',provider:'newsmesh',reliability:80,country_code:'KE',title:'Regional incident bulletin',body:'Armed attack reported near Nairobi',url:'https://publisher-one.test/story',observed_at:observedAt,content_hash:'h1',manipulation_score:0},
        {id:'00000000-0000-0000-0000-000000000004',source_id:'feed-sports',provider:'newsmesh',reliability:90,country_code:'KE',title:'Regional incident bulletin',body:'Football league match preview and tickets are now available',url:'https://publisher-two.test/story',observed_at:observedAt,content_hash:'h2',manipulation_score:0}
      ]})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{id:EVENT}]})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:[{id:'quality-2'}]});
    const result=await fuseOrg(ORG);
    expect(result.created).toBe(1);
    const insert=query.mock.calls[3];
    expect(insert[1][12]).toBe(1);
    expect(insert[1][13]).toBe(1);
    expect(query.mock.calls[4][1][1]).toEqual([OBS]);
  });

  test('inserts a fused intel event with exactly one value per target column', async () => {
    const observedAt = new Date().toISOString();
    query
      // watchlists
      .mockResolvedValueOnce({ rows: [] })
      // observations
      .mockResolvedValueOnce({ rows: [{
        id: OBS,
        source_id: '00000000-0000-0000-0000-000000000010',
        provider: 'test-source',
        reliability: 80,
        country_code: 'KE',
        title: 'Armed attack reported near Nairobi',
        body: 'Test incident body',
        observed_at: observedAt,
        content_hash: 'hash-1',
        manipulation_score: 0,
      }] })
      // existing event lookup
      .mockResolvedValueOnce({ rows: [] })
      // fused event insert
      .mockResolvedValueOnce({ rows: [{ id: EVENT }] })
      // observation linkage
      .mockResolvedValueOnce({ rows: [] })
      // quality history
      .mockResolvedValueOnce({ rows: [{ id: 'quality-1' }] });

    const result = await fuseOrg(ORG);

    expect(result.created).toBe(1);
    const insert = query.mock.calls[3];
    expect(insert).toBeDefined();
    expect(insert[0]).toContain('INSERT INTO intel_events');
    expect(insert[0]).toContain('manipulation_score)');
    expect(insert[0]).toContain('$15) RETURNING id');
    expect(insert[0]).not.toContain('$16');
    expect(insert[1]).toHaveLength(15);
    expect(query).toHaveBeenCalledTimes(6);
  });
});
