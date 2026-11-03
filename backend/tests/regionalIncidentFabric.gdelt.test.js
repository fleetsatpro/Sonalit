'use strict';

jest.mock('../src/config/database',()=>({query:jest.fn(),globalQuery:jest.fn()}));
jest.mock('../src/utils/tenantContext',()=>({runWithOrgContext:(_orgId,work)=>work()}));
jest.mock('../src/utils/telegramMtproto',()=>({
  fetchChannelMessages:jest.fn(async()=>[]),
  fetchPublicChannelPreview:jest.fn(async()=>[]),
  isConfigured:jest.fn(()=>false),
}));
jest.mock('../src/utils/logger',()=>({info:jest.fn(),warn:jest.fn(),error:jest.fn()}));

describe('regional GDELT discovery query',()=>{
  let fetchMock;
  let fetchGdelt;
  let buildGdeltQuery;
  let GDELT_QUERY_MAX_LENGTH;

  beforeEach(()=>{
    jest.resetModules();
    fetchMock=jest.fn();
    jest.spyOn(global,'fetch').mockImplementation(fetchMock);
    ({fetchGdelt,buildGdeltQuery,GDELT_QUERY_MAX_LENGTH}=require('../src/utils/regionalIncidentFabric'));
  });

  afterEach(()=>{
    jest.restoreAllMocks();
  });

  test('query stays short and uses separate, non-nested geography and incident OR groups',()=>{
    const query=buildGdeltQuery();
    expect(query.length).toBeLessThanOrEqual(GDELT_QUERY_MAX_LENGTH);
    expect(GDELT_QUERY_MAX_LENGTH).toBe(240);
    expect(query).toMatch(/^\([^()]+\) \([^()]+\)$/);
    expect((query.match(/\bOR\b/g)||[])).toHaveLength(16);
    expect(query).toContain('"South Sudan"');
    expect(query).toContain('"DR Congo"');
    expect(query).toContain('"roadblock"');
  });

  test('sends the bounded query to GDELT and normalizes returned regional articles',async()=>{
    fetchMock.mockResolvedValue({
      ok:true,
      status:200,
      json:async()=>({articles:[{
        url:'https://nation.africa/kenya/news/security/road-incident',
        title:'Kenya police report an attack on a major road',
        seendate:'20261011043000',
        domain:'nation.africa',
        language:'English',
        sourcecountry:'Kenya',
        tone:'-1.5',
      }]})
    });

    const items=await fetchGdelt();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requested=new URL(fetchMock.mock.calls[0][0]);
    expect(requested.hostname).toBe('api.gdeltproject.org');
    expect(requested.searchParams.get('query')).toBe(buildGdeltQuery());
    expect(requested.searchParams.get('timespan')).toBe('1h');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title:'Kenya police report an attack on a major road',
      url:'https://nation.africa/kenya/news/security/road-incident',
      country_code:'KE',
      credibility:72,
    });
    expect(items[0].external_id).toMatch(/^gdelt:/);
    expect(items[0].published_at).toBe('2026-10-11T04:30:00.000Z');
  });
});
