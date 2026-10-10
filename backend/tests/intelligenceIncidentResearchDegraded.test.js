jest.mock('../src/utils/aiClient',()=>({hasAnyProvider:()=>false,hasReadyProvider:()=>false}));
jest.mock('../src/utils/publicResearchFetch',()=>({safeFetchPublicResearch:jest.fn(),MAX_RESPONSE_BYTES:2*1024*1024}));

const { researchPublicationIncidents, buildIncidentResearchPacket, resolveGoogleNewsArticleUrl, _getConfiguredPublisherFeedsForTests, _readPublisherFeedItemsForTests, _fallbackResearchForTests, _resetGdeltCooldownForTests, _resetResearchCacheForTests } = require('../src/utils/intelligenceIncidentResearch');
const logger=require('../src/utils/logger');
const { safeFetchPublicResearch } = require('../src/utils/publicResearchFetch');

const RESEARCH_FEED_ENV_KEYS = ['INTEL_RSS_FEEDS','INTEL_PUBLICATION_RESEARCH_FEEDS','RISK_INTEL_EXTRA_RSS_FEEDS'];
let previousResearchFeedEnvironment = {};

describe('degraded incident research remains useful',()=>{
  beforeEach(()=>{
    previousResearchFeedEnvironment=Object.fromEntries(RESEARCH_FEED_ENV_KEYS.map(key=>[key,process.env[key]]));
    _resetGdeltCooldownForTests();
    _resetResearchCacheForTests();
    safeFetchPublicResearch.mockClear();
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
    // A successful GDELT request with zero articles must still be counted.
    expect(packet.discovery_summary.gdelt_candidates).toBe(0);
    expect(packet.discovery_summary.gdelt_requested).toBe(true);
    expect(packet.fetched_pages.some(page=>page.url===articleUrl&&page.domain==='allafrica.com'&&page.text.length>=250)).toBe(true);
  });

  test('counts outbound GDELT requests that fail with a rate limit',async()=>{
    for(const key of RESEARCH_FEED_ENV_KEYS)delete process.env[key];
    const feedUrl='https://allafrica.com/tools/headlines/rdf/kenya/headlines.rdf';
    const articleUrl='https://allafrica.com/stories/202610100002.html';
    const articleText='Local reporting describes a security interruption on the freight corridor in Garissa County. Authorities responded to the reported incident, but the initial report does not confirm how long the interruption lasted or when normal movement resumed. The story identifies the affected corridor and states that the operational impact beyond the immediate location remains unclear. It contains no verified casualty total and does not establish any linked incidents elsewhere.';
    const rss='<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns" xmlns="http://purl.org/rss/1.0/"><item><title>Security interruption reported on freight corridor in Garissa County</title><link>'+articleUrl+'</link><description>Local reporting describes a security interruption on the freight corridor in Garissa County after a reported incident. Authorities responded while the duration remained unclear.</description></item></rdf:RDF>';
    safeFetchPublicResearch.mockImplementation(async rawUrl=>{
      const url=String(rawUrl);
      if(url.startsWith('https://api.gdeltproject.org/api/v2/doc/doc')){
        return {ok:false,status:429,url,headers:{get:()=> 'text/html'},text:async()=>'<html>Too many requests</html>'};
      }
      const isRss=url===feedUrl||url.startsWith('https://news.google.com/rss/search')||url.endsWith('/feed')||url.endsWith('.xml');
      const body=url===feedUrl?rss:
        url.startsWith('https://news.google.com/rss/search')?'<rss><channel/></rss>':
        isRss?'<rss><channel/></rss>':
        '<html><head><title>Garissa freight corridor report</title></head><body><article><p>'+articleText+'</p></article></body></html>';
      return {ok:true,status:200,url,headers:{get:()=>isRss?'application/rss+xml':url===feedUrl?'application/rdf+xml':'text/html'},text:async()=>body,arrayBuffer:async()=>Buffer.from(body)};
    });
    const gdeltCallsBefore=safeFetchPublicResearch.mock.calls.filter(([url])=>String(url).startsWith('https://api.gdeltproject.org/api/v2/doc/doc')).length;
    const packet=await buildIncidentResearchPacket({
      id:'KE-gdelt-429',headline:'Security interruption reported on freight corridor in Garissa County',
      region:'Garissa County',occurred_from:'2026-10-09T06:00:00.000Z',evidence:[]
    },{country:'KE'});
    expect(packet.discovery_summary.gdelt_candidates).toBe(0);
    expect(packet.discovery_summary.gdelt_requested).toBe(true);
    const gdeltCallsAfter=safeFetchPublicResearch.mock.calls.filter(([url])=>String(url).startsWith('https://api.gdeltproject.org/api/v2/doc/doc')).length;
    expect(gdeltCallsAfter-gdeltCallsBefore).toBe(1);
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


  test('reuses the existing country-coded publisher registry while preserving AllAfrica as a bounded fallback',()=>{
    const kenya=_getConfiguredPublisherFeedsForTests('KE');
    const somalia=_getConfiguredPublisherFeedsForTests('SO');
    expect(kenya.length).toBeLessThanOrEqual(8);
    expect(kenya.map(feed=>feed.url)).toContain('https://www.kenyanews.go.ke/feed');
    expect(kenya.some(feed=>feed.url==='https://allafrica.com/tools/headlines/rdf/kenya/headlines.rdf')).toBe(true);
    expect(somalia.some(feed=>/shabellemedia\.com\/feed/i.test(feed.url)||/puntlandpost\.net\/feed/i.test(feed.url))).toBe(true);
    expect(kenya.some(feed=>feed.name==='KNA Kenya'&&/news\.google\.com\/rss\/search/.test(feed.fallback_url||''))).toBe(true);
    expect(kenya.some(feed=>feed.name==='Tuko Kenya'&&/news\.google\.com\/rss\/search/.test(feed.fallback_url||''))).toBe(true);
    expect(kenya.some(feed=>feed.name==='Nation Kenya'&&feed.google_news_feed===true)).toBe(true);
    expect([...kenya,...somalia].every(feed=>{
      const url=new URL(feed.url);
      return url.hostname.toLowerCase()!=='news.google.com'||url.pathname==='/rss/search';
    })).toBe(true);
  });

  test('coalesces concurrent malformed-feed parsing and emits one warning per URL',async()=>{
    const feedUrl='https://www.tuko.co.ke/?service=rss';
    const html='<html><body><div><div><div><h1>HTML landing page</h1></div></div></div></body></html>';
    safeFetchPublicResearch.mockImplementation(async rawUrl=>{
      const url=String(rawUrl);
      return {ok:true,status:200,url,headers:{get:()=> 'text/html; charset=utf-8'},text:async()=>html,arrayBuffer:async()=>Buffer.from(html)};
    });
    const warning=jest.spyOn(logger,'warn').mockImplementation(()=>{});
    try{
      const [first,second]=await Promise.all([
        _readPublisherFeedItemsForTests(feedUrl),
        _readPublisherFeedItemsForTests(feedUrl)
      ]);
      expect(first).toBeNull();
      expect(second).toBeNull();
      expect(safeFetchPublicResearch.mock.calls.filter(([url])=>String(url)===feedUrl)).toHaveLength(1);
      expect(warning.mock.calls.filter(([message])=>String(message).includes('host=www.tuko.co.ke'))).toHaveLength(1);
      expect(await _readPublisherFeedItemsForTests(feedUrl)).toBeNull();
      expect(safeFetchPublicResearch.mock.calls.filter(([url])=>String(url)===feedUrl)).toHaveLength(1);
      expect(warning.mock.calls.filter(([message])=>String(message).includes('host=www.tuko.co.ke'))).toHaveLength(1);
    }finally{
      warning.mockRestore();
    }
  });

  test('uses registered Google News fallbacks when primary publisher feeds return HTML or fail TLS',async()=>{
    const tukoFeed='https://www.tuko.co.ke/?service=rss';
    const knaFeed='https://www.kenyanews.go.ke/feed';
    const tukoArticle='https://www.tuko.co.ke/news/local/202610100010.html';
    const knaArticle='https://www.kenyanews.go.ke/news/security/garissa-corridor-update';
    const tukoText='Tuko reporting from Garissa County describes a security interruption affecting the freight corridor. The account records that local authorities responded, while the exact duration of the disruption and any wider transport effects remain unconfirmed. It does not report a verified casualty total or establish that neighbouring routes were affected. The report says further details were being checked and confines its account to the named incident.';
    const knaText='Kenya News Agency reports a separate official account of the Garissa County corridor disruption. Authorities responded to the security incident, but the agency report does not yet establish the full duration, traffic backlog or commercial impact. It reports no verified casualty count and does not conclude that the interruption spread to other routes. The available account remains specific to the event and location.';
    const wrap=url=>'https://news.google.com/rss/articles/'+Buffer.from(url,'utf8').toString('base64url');
    const item=(title,url,description)=>'<item><title>'+title+'</title><link>'+wrap(url)+'</link><pubDate>Fri, 09 Oct 2026 09:00:00 GMT</pubDate><description><![CDATA['+description+']]></description></item>';
    const tukoRss='<rss><channel>'+item('Security incident on Garissa freight corridor — Tuko',tukoArticle,'Local reporting describes a security interruption in Garissa County; duration and wider consequences remain unclear.')+'</channel></rss>';
    const knaRss='<rss><channel>'+item('Official update on Garissa corridor security incident — Kenya News Agency',knaArticle,'Kenya News Agency reports an official response to a security incident affecting the Garissa corridor.')+'</channel></rss>';
    const unrelatedRss='<rss><channel><item><title>Unrelated regional business bulletin</title><link>https://unrelated.example/business-bulletin</link><description>A general business bulletin about retail sales and a scheduled industry conference. It does not mention the reported event, Garissa County, transport security or a corridor interruption.</description></item></channel></rss>';
    const allAfrica='<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns" xmlns="http://purl.org/rss/1.0/"></rdf:RDF>';
    const page=(title,body)=>'<html><head><title>'+title+'</title></head><body><article><p>'+body+'</p></article></body></html>';
    safeFetchPublicResearch.mockImplementation(async rawUrl=>{
      const url=String(rawUrl);
      if(url===tukoFeed){
        const html='<html><body><div><div><div><h1>Tuko home</h1><p>HTML page, not an RSS feed.</p></div></div></div></body></html>';
        return {ok:true,status:200,url,headers:{get:()=> 'text/html; charset=utf-8'},text:async()=>html,arrayBuffer:async()=>Buffer.from(html)};
      }
      if(url===knaFeed)throw Object.assign(new Error('External research request failed: SELF_SIGNED_CERT_IN_CHAIN'),{failureClass:'unavailable',code:'SELF_SIGNED_CERT_IN_CHAIN'});
      if(url===tukoArticle){
        return {ok:true,status:200,url,headers:{get:()=> 'text/html; charset=utf-8'},text:async()=>page('Tuko Garissa security update',tukoText),arrayBuffer:async()=>Buffer.from(page('Tuko Garissa security update',tukoText))};
      }
      if(url===knaArticle){
        return {ok:true,status:200,url,headers:{get:()=> 'text/html; charset=utf-8'},text:async()=>page('KNA Garissa corridor update',knaText),arrayBuffer:async()=>Buffer.from(page('KNA Garissa corridor update',knaText))};
      }
      if(url.includes('allafrica.com/tools/headlines/rdf/kenya/headlines.rdf')){
        return {ok:true,status:200,url,headers:{get:()=> 'application/rdf+xml'},text:async()=>allAfrica,arrayBuffer:async()=>Buffer.from(allAfrica)};
      }
      if(url.startsWith('https://news.google.com/rss/search')){
        const query=new URL(url).searchParams.get('q')||'';
        const body=query.includes('site:tuko.co.ke')?tukoRss:
          query.includes('site:kenyanews.go.ke')?knaRss:unrelatedRss;
        return {ok:true,status:200,url,headers:{get:()=> 'application/rss+xml; charset=utf-8'},text:async()=>body,arrayBuffer:async()=>Buffer.from(body)};
      }
      if(url==='https://unrelated.example/business-bulletin'){
        return {ok:true,status:200,url,headers:{get:()=> 'text/html'},text:async()=>page('Unrelated bulletin','This general business item does not contain incident details.'),arrayBuffer:async()=>Buffer.from(page('Unrelated bulletin','This general business item does not contain incident details.'))};
      }
      return {ok:true,status:200,url,headers:{get:()=> 'application/rss+xml'},text:async()=>unrelatedRss,arrayBuffer:async()=>Buffer.from(unrelatedRss)};
    });
    const packet=await buildIncidentResearchPacket({
      id:'KE-publisher-fallback',headline:'Security incident reported on Garissa freight corridor',
      region:'Garissa County',occurred_from:'2026-10-09T06:00:00.000Z',evidence:[]
    },{country:'KE'});
    expect(safeFetchPublicResearch.mock.calls.some(([url])=>String(url)===tukoFeed)).toBe(true);
    expect(safeFetchPublicResearch.mock.calls.some(([url])=>String(url)===knaFeed)).toBe(true);
    expect(safeFetchPublicResearch.mock.calls.some(([url])=>String(url).startsWith('https://news.google.com/rss/search')&&(new URL(String(url)).searchParams.get('q')||'').includes('site:tuko.co.ke'))).toBe(true);
    expect(safeFetchPublicResearch.mock.calls.some(([url])=>String(url).startsWith('https://news.google.com/rss/search')&&(new URL(String(url)).searchParams.get('q')||'').includes('site:kenyanews.go.ke'))).toBe(true);
    expect(packet.fetched_pages.some(page=>page.url===tukoArticle&&page.domain==='tuko.co.ke'&&String(page.text||'').length>=250)).toBe(true);
    expect(packet.fetched_pages.some(page=>page.url===knaArticle&&page.domain==='kenyanews.go.ke'&&String(page.text||'').length>=250)).toBe(true);
    expect(packet.discovery_summary.gdelt_requested).toBe(false);
    expect(new Set(packet.fetched_pages.filter(page=>String(page.text||'').length>=250).map(page=>page.domain)).size).toBeGreaterThanOrEqual(2);
  });

  test('does not call GDELT when independent direct-publisher bodies already satisfy the source threshold',async()=>{
    const headline='Violence interrupts freight corridor in Garissa County';
    const allAfricaFeed='https://allafrica.com/tools/headlines/rdf/kenya/headlines.rdf';
    const allAfricaArticle='https://allafrica.com/stories/202610100001.html';
    const secondArticle='https://publisher.example/garissa-security-report';
    const allAfricaBody='Local reporting describes a security interruption on the freight corridor in Garissa County. Authorities responded to the reported incident, but the initial report does not confirm how long the interruption lasted or when normal movement resumed. The story identifies the affected corridor and states that the operational impact beyond the immediate location remains unclear. It contains no verified casualty total and does not establish any linked incidents elsewhere.';
    const secondBody='A separate local publisher reports that a security incident temporarily interrupted movement along the freight corridor in Garissa County. The article describes an official response but says the exact duration, traffic backlog and wider commercial effects remain unconfirmed. It does not establish casualty figures or confirm that other routes were affected. The publisher treats the event as an isolated report pending further official detail.';
    const allAfricaRss='<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns" xmlns="http://purl.org/rss/1.0/"><item><title>Violence interrupts freight corridor in Garissa County</title><link>'+allAfricaArticle+'</link><description>Local reporting describes a security interruption on the freight corridor in Garissa County after a reported incident.</description></item></rdf:RDF>';
    const googleRss='<rss><channel><item><title>Violence interrupts freight corridor in Garissa County — Local Publisher</title><link>'+secondArticle+'</link><pubDate>Fri, 09 Oct 2026 09:00:00 GMT</pubDate><description>A separate local publisher reports a temporary disruption and official response in Garissa County.</description></item></channel></rss>';
    const page=(title,body)=>'<html><head><title>'+title+'</title></head><body><article><p>'+body+'</p></article></body></html>';
    safeFetchPublicResearch.mockImplementation(async rawUrl=>{
      const url=String(rawUrl);
      let contentType='application/rss+xml',body='<rss><channel/></rss>';
      if(url===allAfricaFeed)body=allAfricaRss;
      else if(url.startsWith('https://news.google.com/rss/search'))body=googleRss;
      else if(url===allAfricaArticle){contentType='text/html';body=page('AllAfrica Garissa report',allAfricaBody);}
      else if(url===secondArticle){contentType='text/html';body=page('Garissa corridor report',secondBody);}
      else if(url.startsWith('https://api.gdeltproject.org/api/v2/doc/doc'))throw new Error('GDELT should not be called after source coverage is adequate');
      return {ok:true,status:200,url,headers:{get:()=>contentType},text:async()=>body,arrayBuffer:async()=>Buffer.from(body)};
    });
    const gdeltCallsBefore=safeFetchPublicResearch.mock.calls.filter(([url])=>String(url).startsWith('https://api.gdeltproject.org/api/v2/doc/doc')).length;
    const packet=await buildIncidentResearchPacket({
      id:'KE-budget-1',headline,region:'Garissa County',occurred_from:'2026-10-09T06:00:00.000Z',evidence:[]
    },{country:'KE'});
    expect(packet.discovery_summary.gdelt_requested).toBe(false);
    expect(packet.discovery_summary.gdelt_candidates).toBe(0);
    expect(new Set(packet.fetched_pages.filter(page=>String(page.text||'').length>=250).map(page=>page.domain)).size).toBeGreaterThanOrEqual(2);
    const gdeltCallsAfter=safeFetchPublicResearch.mock.calls.filter(([url])=>String(url).startsWith('https://api.gdeltproject.org/api/v2/doc/doc')).length;
    expect(gdeltCallsAfter-gdeltCallsBefore).toBe(0);
  });


  test('negative-caches unavailable publisher feeds across incident packets',async()=>{
    const feedUrl='https://allafrica.com/tools/headlines/rdf/kenya/headlines.rdf';
    let feedAttempts=0;
    safeFetchPublicResearch.mockImplementation(async url=>{
      const value=String(url);
      if(value===feedUrl){
        feedAttempts+=1;
        throw Object.assign(new Error('External research request failed: ECONNREFUSED'),{failureClass:'unavailable',code:'ECONNREFUSED'});
      }
      if(value.startsWith('https://news.google.com/rss/search')){
        const body='<rss><channel/></rss>';
        return {ok:true,status:200,url:value,headers:{get:()=> 'application/rss+xml'},text:async()=>body,arrayBuffer:async()=>Buffer.from(body)};
      }
      const body='{"articles":[]}';
      return {ok:true,status:200,url:value,headers:{get:()=> 'application/json'},text:async()=>body,arrayBuffer:async()=>Buffer.from(body)};
    });
    const event={id:'KE-feed-failure',headline:'Security disruption in Garissa County',region:'Garissa County',evidence:[]};
    await buildIncidentResearchPacket(event,{country:'KE'});
    await buildIncidentResearchPacket({...event,id:'KE-feed-failure-2'},{country:'KE'});
    expect(feedAttempts).toBe(1);
  });

  test('resolves opaque Google News wrappers to publisher bodies using validated HTTPS redirects',async()=>{
    const wrapperUrl='https://news.google.com/rss/articles/CBMiOpaqueArticleToken';
    const publisherUrl='https://publisher.example/security/garissa-corridor';
    const publisherBody='A local publisher reports a security interruption along the Garissa corridor. Authorities responded to the incident, but the source does not establish the exact duration, any casualty count or a wider pattern beyond the named area. The account says follow-up details were still being checked and does not claim that other routes were affected.';
    const rss='<rss><channel><item><title>Security interruption along Garissa corridor</title><link>'+wrapperUrl+'</link><pubDate>Fri, 09 Oct 2026 09:00:00 GMT</pubDate><source>Local publisher</source><description>Local publisher reports a security interruption along the Garissa corridor; duration and wider effects remain unclear.</description></item></channel></rss>';
    safeFetchPublicResearch.mockImplementation(async rawUrl=>{
      const url=String(rawUrl);
      if(url===wrapperUrl){
        const html='<html><body><article><p>'+publisherBody+'</p></article></body></html>';
        return {ok:true,status:200,url:publisherUrl,headers:{get:()=> 'text/html'},text:async()=>html,arrayBuffer:async()=>Buffer.from(html)};
      }
      if(url.startsWith('https://news.google.com/rss/search')){
        return {ok:true,status:200,url,headers:{get:()=> 'application/rss+xml'},text:async()=>rss,arrayBuffer:async()=>Buffer.from(rss)};
      }
      if(url==='https://allafrica.com/tools/headlines/rdf/kenya/headlines.rdf'){
        const empty='<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns"/>';
        return {ok:true,status:200,url,headers:{get:()=> 'application/rdf+xml'},text:async()=>empty,arrayBuffer:async()=>Buffer.from(empty)};
      }
      if(url.startsWith('https://api.gdeltproject.org/api/v2/doc/doc')){
        const payload=JSON.stringify({articles:[{title:'Independent Garissa update',url:'https://second-publisher.example/security-update',domain:'second-publisher.example'}]});
        return {ok:true,status:200,url,headers:{get:()=> 'application/json'},text:async()=>payload,arrayBuffer:async()=>Buffer.from(payload)};
      }
      if(url==='https://second-publisher.example/security-update'){
        const body='A second independent report describes the same security interruption in Garissa County and records a response by local authorities. It does not confirm the duration or establish a casualty figure. The source does not identify other affected routes, and its account remains limited to the specific incident.';
        const html='<html><head><title>Garissa security update</title></head><body><article><p>'+body+'</p></article></body></html>';
        return {ok:true,status:200,url,headers:{get:()=> 'text/html'},text:async()=>html,arrayBuffer:async()=>Buffer.from(html)};
      }
      const html='<html></html>';
      return {ok:true,status:200,url,headers:{get:()=> 'text/html'},text:async()=>html,arrayBuffer:async()=>Buffer.from(html)};
    });
    const packet=await buildIncidentResearchPacket({id:'KE-wrapper',headline:'Security interruption along Garissa corridor',region:'Garissa County',occurred_from:'2026-10-09T06:00:00.000Z',evidence:[]},{country:'KE'});
    expect(packet.discovery_summary.google_news_candidates).toBeGreaterThan(0);
    expect(packet.fetched_pages.some(page=>page.url===publisherUrl&&page.domain==='publisher.example'&&String(page.text||'').length>=120)).toBe(true);
    expect(safeFetchPublicResearch.mock.calls.filter(([url])=>String(url)===publisherUrl)).toHaveLength(0);
  });

});
