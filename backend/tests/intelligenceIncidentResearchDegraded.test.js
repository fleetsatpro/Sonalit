jest.mock('../src/utils/aiClient',()=>({hasAnyProvider:()=>false}));
jest.mock('../src/utils/publicResearchFetch',()=>({safeFetchPublicResearch:jest.fn(),MAX_RESPONSE_BYTES:2*1024*1024}));

const { researchPublicationIncidents } = require('../src/utils/intelligenceIncidentResearch');
const { safeFetchPublicResearch } = require('../src/utils/publicResearchFetch');

describe('degraded incident research remains useful',()=>{
  afterEach(()=>{delete global.fetch});
  test('turns live web research into a substantive dossier when no model provider is available',async()=>{
    const rss='<rss><channel><item><title>Independent report on the incident</title><link>https://example.com/report</link><pubDate>Sat, 04 Oct 2026 08:00:00 GMT</pubDate><source>Example News</source><description><![CDATA[Local reporting describes a temporary disruption on the corridor and notes that authorities responded while the full duration remained unclear.]]></description></item></channel></rss>';
    const article='<html><head><title>Independent report on the incident</title><meta name="description" content="Local reporting describes a temporary disruption on the corridor and notes that authorities responded while the full duration remained unclear."></head><body><main><p>The report places the incident on the affected corridor and describes a temporary disruption. It also records that authorities responded and that the precise duration was not yet established.</p></main></body></html>';
    const gdeltJson=jest.fn(async()=>({articles:[{
      title:'Corroborating public report on corridor disruption',
      url:'https://example.com/report',
      seendate:'20261009T100000Z',
      domain:'example.com'
    }]}));
    safeFetchPublicResearch.mockImplementation(async(url)=>{
      const value=String(url);
      const isRss=value.startsWith('https://news.google.com/rss/search');
      const isGdelt=value.startsWith('https://api.gdeltproject.org/api/v2/doc/doc');
      return {
        ok:true,status:200,url:value,
        headers:{get:()=>isRss?'application/rss+xml':isGdelt?'application/json':'text/html'},
        text:async()=>isRss?rss:article,
        json:isGdelt?gdeltJson:async()=>({articles:[]}),
        arrayBuffer:async()=>Buffer.from(isRss?rss:isGdelt?'{}':article)
      };
    });
    const events=[{
      id:'incident-1',
      headline:'Temporary corridor disruption reported',
      brief:'An interruption was reported on a major road corridor.',
      summary:'An interruption was reported on a major road corridor.',
      region:'Northern corridor',
      evidence:[]
    }];
    const result=await researchPublicationIncidents(events,{country:'KE'});
    const dossier=result.byEvent['incident-1'];
    expect(result.summary.requested).toBe(1);
    expect(result.summary.fallback).toBe(1);
    expect(result.summary.web_packet_researched).toBe(1);
    expect(gdeltJson).toHaveBeenCalled();
    expect(safeFetchPublicResearch.mock.calls.some(([url])=>String(url).startsWith('https://api.gdeltproject.org/api/v2/doc/doc'))).toBe(true);
    expect(result.summary.web_sources_retrieved).toBeGreaterThanOrEqual(1);
    expect(dossier.agent.research_method).toBe('live_web_packet');
    expect(dossier.agent.agent_status).toBe('provider_unavailable');
    expect(dossier.agent.narrative.length).toBeGreaterThan(220);
    expect(dossier.agent.sources.length).toBeGreaterThanOrEqual(1);
  });
});
