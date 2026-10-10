jest.mock('../src/utils/aiClient',()=>({hasAnyProvider:()=>false,hasReadyProvider:()=>false}));
jest.mock('../src/utils/publicResearchFetch',()=>({safeFetchPublicResearch:jest.fn(),MAX_RESPONSE_BYTES:2*1024*1024}));

const { researchPublicationIncidents, buildIncidentResearchPacket, resolveGoogleNewsArticleUrl, _fallbackResearchForTests, _resetGdeltCooldownForTests, _resetResearchCacheForTests } = require('../src/utils/intelligenceIncidentResearch');
const { safeFetchPublicResearch } = require('../src/utils/publicResearchFetch');

const RESEARCH_FEED_ENV_KEYS = ['INTEL_RSS_FEEDS','INTEL_PUBLICATION_RESEARCH_FEEDS','RISK_INTEL_EXTRA_RSS_FEEDS'];
let previousResearchFeedEnvironment = {};

describe('degraded incident research remains useful',()=>{
  beforeEach(()=>{
    previousResearchFeedEnvironment=Object.fromEntries(RESEARCH_FEED_ENV_KEYS.map(key=>[key,process.env[key]]));
    _resetGdeltCooldownForTests();
    _resetResearchCacheForTests();
  });
  afterEach(()=>{
    _resetGdeltCooldownForTests();
    _resetResearchCacheForTests();
    delete global.fetch;
    for(const key of RESEARCH_FEED_ENV_KEYS){
      if(previousResearchFeedEnvironment[key]===undefined)delete process.env[key];
      else process.env[key]=previousResearchFeedEnvironment[key];
    }
  });
  test('turns live web research into a substantive dossier when no model provider is available',async()=>{
    const rss='<rss><channel><item><title>Independent report on the incident</title><link>https://example.com/report</link><pubDate>Sat, 04 Oct 2026 08:00:00 GMT</pubDate><source>Example News</source><description><![CDATA[Local reporting describes a temporary disruption on the corridor and notes that authorities responded while the full duration remained unclear.]]></description></item></channel></rss>';
    const article='<html><head><title>Independent report on the incident</title><meta name="description" content="Local reporting describes a temporary disruption on the corridor and notes that authorities responded while the full duration remained unclear."></head><body><main><p>The report places the incident on the affected corridor and describes a temporary disruption. It also records that authorities responded and that the precise duration was not yet established.</p></main></body></html>';
    const gdeltText=jest.fn(async()=>JSON.stringify({articles:[{
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
        text:async()=>isRss?rss:isGdelt?await gdeltText():article,
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
    expect(gdeltText).toHaveBeenCalled();
    expect(safeFetchPublicResearch.mock.calls.some(([url])=>String(url).startsWith('https://api.gdeltproject.org/api/v2/doc/doc'))).toBe(true);
    expect(result.summary.web_sources_retrieved).toBeGreaterThanOrEqual(1);
    expect(dossier.agent.research_method).toBe('live_web_packet');
    expect(dossier.agent.agent_status).toBe('provider_unavailable');
    expect(dossier.agent.narrative.length).toBeGreaterThan(220);
    expect(dossier.agent.sources.length).toBeGreaterThanOrEqual(1);
  });

  test('Google News wrapper links are resolved only when a publisher URL can be decoded',()=>{
    const publisherUrl='https://local.example/security/corridor-update';
    const token=Buffer.from(publisherUrl,'utf8').toString('base64url');
    expect(resolveGoogleNewsArticleUrl('https://news.google.com/rss/articles/'+token)).toBe(publisherUrl);
    expect(resolveGoogleNewsArticleUrl('https://news.google.com/rss/articles/opaque-wrapper-token')).toBeNull();
    expect(resolveGoogleNewsArticleUrl('https://news.google.com/rss/articles/'+Buffer.from('https://news.google.com/rss/about').toString('base64url'))).toBeNull();
    expect(resolveGoogleNewsArticleUrl(publisherUrl)).toBe(publisherUrl);
  });

  test('publication research consumes only country-matched configured RSS and records direct publisher pages',async()=>{
    const headline='Temporary corridor disruption in Garissa County';
    const rss='<rss><channel><item><title>Temporary corridor disruption in Garissa County</title><link>https://publisher.example/garissa-disruption</link><pubDate>Fri, 09 Oct 2026 08:00:00 GMT</pubDate><description><![CDATA[Local reporting describes a temporary interruption on the Garissa corridor after a security incident. Authorities responded and the duration and wider commercial impact remained unclear.]]></description></item></channel></rss>';
    const article='<html><head><title>Garissa corridor report</title><meta name="description" content="A report on the interruption."></head><body><article><p>Local reporting describes a temporary interruption on the Garissa corridor after a security incident. Authorities responded and the duration and wider commercial impact remained unclear. The report does not establish whether traffic resumed normally later in the day or whether other routes were affected.</p></article></body></html>';
    process.env.INTEL_RSS_FEEDS=JSON.stringify([
      {name:'Kenya publisher',url:'https://publisher.example/feed.xml',country_code:'KE'},
      {name:'Wrong-country publisher',url:'https://other.example/feed.xml',country_code:'SO'}
    ]);
    safeFetchPublicResearch.mockImplementation(async(url)=>{
      const value=String(url);
      const headers={get:()=>value.includes('/rss/search')?'application/rss+xml':value.includes('feed.xml')?'application/rss+xml':value.includes('api.gdeltproject.org')?'application/json':'text/html'};
      const body=value==='https://publisher.example/feed.xml'?rss:
        value==='https://other.example/feed.xml'?rss:
        value.startsWith('https://news.google.com/rss/search')?'<rss><channel/></rss>':
        value.startsWith('https://api.gdeltproject.org/api/v2/doc/doc')?'{"articles":[]}':article;
      return {ok:true,status:200,url:value,headers,text:async()=>body,arrayBuffer:async()=>Buffer.from(body)};
    });
    const packet=await buildIncidentResearchPacket({
      id:'KE-feed-1',headline,region:'Garissa County',occurred_from:'2026-10-09T06:00:00.000Z',evidence:[]
    },{country:'KE'});
    expect(packet.discovery_summary.configured_rss_candidates).toBe(1);
    expect(packet.fetched_pages.some(page=>page.url==='https://publisher.example/garissa-disruption')).toBe(true);
    expect(packet.fetched_pages.some(page=>page.domain==='other.example')).toBe(false);
    expect(packet.fetched_pages.some(page=>String(page.text||'').length>=120)).toBe(true);
  });

  test('uses the built-in country AllAfrica RSS lane when no curated feed is configured',async()=>{
    for(const key of RESEARCH_FEED_ENV_KEYS)delete process.env[key];
    const feedUrl='https://allafrica.com/tools/headlines/rdf/kenya/headlines.rdf';
    const articleUrl='https://allafrica.com/stories/202610100001.html';
    const articleText='Local reporting describes a security interruption on the freight corridor in Garissa County. Authorities responded to the reported incident, but the initial report does not confirm how long the interruption lasted or when normal movement resumed. The story identifies the affected corridor and states that the operational impact beyond the immediate location remains unclear. It contains no verified casualty total and does not establish any linked incidents elsewhere.';
    const rss='<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns" xmlns="http://purl.org/rss/1.0/"><item><title>Violence interrupts freight corridor in Garissa County</title><link>'+articleUrl+'</link><description>Local reporting describes a security interruption on the freight corridor in Garissa County after a reported incident. Authorities responded, while the duration and wider transport impact remained unclear.</description></item></rdf:RDF>';
    safeFetchPublicResearch.mockImplementation(async rawUrl=>{
      const url=String(rawUrl);
      const headers={get:()=>url===feedUrl?'application/rdf+xml':url.startsWith('https://news.google.com/rss/search')?'application/rss+xml':url.startsWith('https://api.gdeltproject.org/api/v2/doc/doc')?'application/json':'text/html'};
      const body=url===feedUrl?rss:
        url.startsWith('https://news.google.com/rss/search')?'<rss><channel/></rss>':
        url.startsWith('https://api.gdeltproject.org/api/v2/doc/doc')?'{"articles":[]}':
        '<html><head><title>Garissa corridor security report</title></head><body><article><p>'+articleText+'</p></article></body></html>';
      return {ok:true,status:200,url,headers,text:async()=>body};
    });
    const packet=await buildIncidentResearchPacket({
      id:'KE-allafrica-1',
      headline:'Violence interrupts freight corridor in Garissa County',
      region:'Garissa County',
      occurred_from:'2026-10-09T06:00:00.000Z',
      evidence:[]
    },{country:'KE'});
    expect(safeFetchPublicResearch).toHaveBeenCalledWith(feedUrl,expect.objectContaining({timeoutMs:10000}));
    expect(packet.discovery_summary.configured_rss_candidates).toBe(1);
    expect(packet.fetched_pages.some(page=>page.url===articleUrl&&page.domain==='allafrica.com'&&page.text.length>=250)).toBe(true);
  });

  test('fallback research never labels metadata-only source rows as researched_limited',()=>{
    const event={id:'KE-metadata-only',headline:'Reported corridor disruption',region:'Garissa',brief:'A reported interruption affected a transport corridor.',evidence:[]};
    const packet={fetched_pages:[
      {url:'https://one.example/report',domain:'one.example',title:'Corridor report',description:'A short summary.'},
      {url:'https://two.example/report',domain:'two.example',title:'Corridor update',description:'Another short summary.'}
    ]};
    expect(_fallbackResearchForTests(event,packet).status).toBe('fallback');
    const substantial={fetched_pages:[
      {url:'https://one.example/report',domain:'one.example',title:'Corridor report',text:'The report describes a disruption on the corridor and states that authorities responded. It says the duration remained uncertain and does not establish any effect on adjacent routes. The location is given as Garissa County and the incident was reported on Friday morning. No casualty count is provided in this source.'},
      {url:'https://two.example/report',domain:'two.example',title:'Corridor update',text:'A separate publisher reports a temporary interruption on the Garissa corridor. Its account also notes a response by local authorities, but does not confirm when all traffic resumed. The source gives no verified casualty count and does not establish a wider pattern of attacks on the route.'}
    ]};
    expect(_fallbackResearchForTests(event,substantial).status).toBe('researched_limited');
  });

});
