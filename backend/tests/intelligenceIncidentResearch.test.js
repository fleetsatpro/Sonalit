jest.mock('../src/utils/aiClient',()=>({
  // Configured-but-cooling is intentionally distinct from no configured provider.
  hasAnyProvider:jest.fn(()=>false),
  hasReadyProvider:jest.fn(()=>false),
  createResearchMessage:jest.fn(),
}));

jest.mock('../src/utils/publicResearchFetch',()=>({
  safeFetchPublicResearch:jest.fn(),
  MAX_RESPONSE_BYTES:2*1024*1024,
}));

const { researchPublicationIncidents, verifiedResponseSources, parseGdeltResponse, _resetGdeltCooldownForTests, _resetResearchCacheForTests } = require('../src/utils/intelligenceIncidentResearch');
const { safeFetchPublicResearch } = require('../src/utils/publicResearchFetch');
const { auditPublicationContent } = require('../src/utils/publicationQuality');

function installResearchFetchFixture() {
  safeFetchPublicResearch.mockReset();
  safeFetchPublicResearch.mockImplementation(async rawUrl => {
    const url = String(rawUrl);
    const isGdelt = url.startsWith('https://api.gdeltproject.org/api/v2/doc/doc');
    const isGoogleNews = url.startsWith('https://news.google.com/rss/search');
    const rss = '<rss><channel></channel></rss>';
    return {
      ok: true,
      status: 200,
      url,
      headers: { get: () => isGdelt ? 'application/json; charset=utf-8' : isGoogleNews ? 'application/rss+xml' : 'text/html' },
      text: async () => isGdelt ? JSON.stringify({ articles: [] }) : isGoogleNews ? rss : '<html><head><title>Research fixture</title></head><body><main><p>A bounded deterministic research fixture without factual assertions.</p></main></body></html>',
      json: async () => ({ articles: [] }),
    };
  });
}

beforeEach(() => {
  // Start every test with protocol-correct fixtures. Malformed mock responses
  // must not open the module-level GDELT cooldown for unrelated tests.
  installResearchFetchFixture();
});

// The GDELT circuit is deliberately module-scoped in production; reset it between
// tests so one mocked provider failure cannot contaminate unrelated scenarios.
beforeEach(()=>{_resetGdeltCooldownForTests();_resetResearchCacheForTests();});
afterEach(()=>{_resetGdeltCooldownForTests();_resetResearchCacheForTests();delete process.env.INTEL_RSS_FEEDS;delete process.env.INTEL_PUBLICATION_RESEARCH_FEEDS;delete process.env.RISK_INTEL_EXTRA_RSS_FEEDS;});

test('passes publication data-classification policy into AI incident research',async()=>{
  const aiClient=require('../src/utils/aiClient');
  const previousClassification=process.env.INTEL_PUBLICATION_DATA_CLASSIFICATION;
  process.env.INTEL_PUBLICATION_DATA_CLASSIFICATION='public';
  process.env.INTEL_RSS_FEEDS=JSON.stringify([
    {name:'Independent source A',url:'https://alpha.example/feed.xml',country_code:'KE'},
    {name:'Independent source B',url:'https://bravo.example/feed.xml',country_code:'KE'}
  ]);
  const articleTextA='The report describes a specific development affecting the policy propagation process at a named operational location. Local authorities responded, but this report does not independently establish the total duration or the full set of consequences. The article records what was reported, distinguishes confirmed details from open questions, and notes that further official information is needed before drawing wider conclusions. The available text does not support claims about casualties or a regional trend.';
  const articleTextB='A second independent report describes the policy propagation incident from a separate publisher and provides a different account of the immediate operational impact. It says the timing of a full resolution remained unconfirmed and does not establish any linked events in neighbouring areas. The report records the limits of the available evidence and identifies the facts that would need confirmation before any wider assessment could be supported. It makes no verified claim about casualties.';
  safeFetchPublicResearch.mockImplementation(async rawUrl=>{
    const url=String(rawUrl);
    const parsed=new URL(url);
    const headers={get:()=>url.includes('/feed.xml')?'application/rss+xml':url.startsWith('https://news.google.com/rss/search')?'application/rss+xml':url.startsWith('https://api.gdeltproject.org/api/v2/doc/doc')?'application/json':'text/html'};
    const body=url==='https://alpha.example/feed.xml'
      ? '<rss><channel><item><title>Policy propagation incident at the primary facility</title><link>https://alpha.example/report</link><pubDate>Fri, 09 Oct 2026 08:00:00 GMT</pubDate><description>Independent report of a policy propagation incident.</description></item></channel></rss>'
      : url==='https://bravo.example/feed.xml'
        ? '<rss><channel><item><title>Policy propagation incident reported independently</title><link>https://bravo.example/report</link><pubDate>Fri, 09 Oct 2026 09:00:00 GMT</pubDate><description>A second publisher reports the policy propagation incident.</description></item></channel></rss>'
        : url.startsWith('https://news.google.com/rss/search')?'<rss><channel></channel></rss>'
          : url.startsWith('https://api.gdeltproject.org/api/v2/doc/doc')?'{"articles":[]}'
            : '<html><head><title>Independent publisher report</title></head><body><main><p>'+ (parsed.hostname==='alpha.example'?articleTextA:articleTextB) +'</p></main></body></html>';
    return {ok:true,status:200,url,headers,text:async()=>body,json:async()=>({articles:[]})};
  });
  aiClient.hasAnyProvider.mockReturnValue(true);
  const narrative='The incident occurred within the reported period and affected a named location. Available reporting indicates a specific operational development, while the available evidence does not establish a broader deterioration. Independent reporting provides useful corroboration but leaves material uncertainty about the immediate consequences and next-stage response. This assessment should therefore remain bounded to the incident and its verified context.';
  const payload=[{
    incident_id:'i-policy',
    status:'researched',
    narrative,
    context:'The event sits within a defined local operating environment.',
    confirmed_facts:['A reported incident occurred.'],
    reported_or_disputed:[],
    analytical_assessment:'The evidence supports a localized assessment rather than a wider regional deterioration.',
    why_it_matters:['It may affect near-term operating conditions.'],
    uncertainty:['The downstream effect remains uncertain.'],
    chronology:[],
    sources:[
      {title:'Independent source A',url:'https://alpha.example/report',domain:'alpha.example',source_type:'web'},
      {title:'Independent source B',url:'https://bravo.example/report',domain:'bravo.example',source_type:'web'}
    ]
  }];
  aiClient.createResearchMessage.mockResolvedValue({
    _provider:'openrouter-free-router',
    content:[
      {type:'text',text:JSON.stringify({results:payload})},
      {type:'web_search_tool_result',content:[
        {type:'web_search_result',title:'Independent source A',url:'https://alpha.example/report',domain:'alpha.example'},
        {type:'web_search_result',title:'Independent source B',url:'https://bravo.example/report',domain:'bravo.example'}
      ]}
    ]
  });
  const result=await researchPublicationIncidents([
    {id:'i-policy',headline:'Policy propagation incident',brief:'A specific incident for policy coverage.',country_code:'KE',evidence:[]}
  ],{country:'KE'});
  expect(aiClient.hasAnyProvider).toHaveBeenCalledWith({
    dataClassification:'public',
    allowFreeProviders:true,
  });
  expect(aiClient.createResearchMessage).toHaveBeenCalledWith(expect.objectContaining({
    dataClassification:'public',
    allowFreeProviders:true,
    providerHints:expect.arrayContaining(['google-gemini-3.8-flash','openrouter-free-router']),
    responseFormat:expect.objectContaining({type:'json_schema'}),
  }));
  expect(result.summary.researched).toBe(1);
  expect(result.byEvent['i-policy'].agent.status).toBe('researched');
  expect(result.byEvent['i-policy'].agent.sources.filter(source=>String(source.source_type)==='retrieved_web_page')).toHaveLength(2);
  expect(result.byEvent['i-policy'].agent.sources.every(source=>!Object.prototype.hasOwnProperty.call(source,'text'))).toBe(true);
  expect(result.byEvent['i-policy'].agent.provider).toBe('openrouter-free-router');
  if(previousClassification===undefined)delete process.env.INTEL_PUBLICATION_DATA_CLASSIFICATION;
  else process.env.INTEL_PUBLICATION_DATA_CLASSIFICATION=previousClassification;
});

describe('publication incident research coverage',()=>{
  afterEach(()=>{delete global.fetch});
  test('does not skip research just because configured providers are temporarily cooling down',async()=>{
    const aiClient=require('../src/utils/aiClient');
    const previousClassification=process.env.INTEL_PUBLICATION_DATA_CLASSIFICATION;
    process.env.INTEL_PUBLICATION_DATA_CLASSIFICATION='public';
    aiClient.hasAnyProvider.mockReset().mockReturnValue(true);
    aiClient.hasReadyProvider.mockReset().mockReturnValue(false);
    aiClient.createResearchMessage.mockReset().mockResolvedValue({
      _provider:'openrouter-free-router',
      content:[{type:'text',text:JSON.stringify({results:[]})}]
    });
    try {
      const result=await researchPublicationIncidents([
        {id:'i-circuit-cooldown',headline:'Temporary border crossing disruption',brief:'A reported temporary crossing disruption.',country_code:'KE',evidence:[]}
      ],{country:'KE'});
      expect(aiClient.hasAnyProvider).toHaveBeenCalledWith({
        dataClassification:'public',
        allowFreeProviders:true,
      });
      expect(aiClient.hasReadyProvider).not.toHaveBeenCalled();
      expect(aiClient.createResearchMessage).toHaveBeenCalled();
      expect(result.summary.requested).toBe(1);
    } finally {
      aiClient.hasAnyProvider.mockReset().mockReturnValue(false);
      aiClient.hasReadyProvider.mockReset().mockReturnValue(false);
      aiClient.createResearchMessage.mockReset();
      if (previousClassification === undefined) delete process.env.INTEL_PUBLICATION_DATA_CLASSIFICATION;
      else process.env.INTEL_PUBLICATION_DATA_CLASSIFICATION=previousClassification;
    }
  });

  test('continues evidence collection when the AI provider fabric is unavailable',async()=>{
    const events=[
      {id:'i1',headline:'Incident one',brief:'First incident',country_code:'KE',evidence:[]},
      {id:'i2',headline:'Incident two',brief:'Second incident',country_code:'KE',evidence:[]},
      {id:'i3',headline:'Incident three',brief:'Third incident',country_code:'KE',evidence:[]},
      {id:'i4',headline:'Incident four',brief:'Fourth incident',country_code:'KE',evidence:[]},
      {id:'i5',headline:'Incident five',brief:'Fifth incident',country_code:'KE',evidence:[]}
    ];
    const result=await researchPublicationIncidents(events,{country:'KE'});
    expect(result.summary.requested).toBe(5);
    expect(Object.keys(result.byEvent)).toHaveLength(5);
    expect(result.summary.fallback).toBe(5);
    expect(result.summary.deferred).toBe(0);
    expect(result.summary.halted).toBeFalsy();
    expect(safeFetchPublicResearch).toHaveBeenCalled();
  });
});


test('provider research citations must come from non-text verified web-search result blocks',()=>{
  const sources=verifiedResponseSources({
    content:[
      {type:'text',text:'{"sources":[{"url":"https://invented.example/report"},{"url":"https://real.example/report"}]}'},
      {type:'web_search_tool_result',content:[
        {type:'web_search_result',title:'Verified report',url:'https://real.example/report',domain:'real.example'}
      ]}
    ]
  });
  expect(sources.map(x=>x.url)).toEqual(['https://real.example/report']);
});


test('successful researched incidents persist an explicit research method',()=>{
  const source=require('fs').readFileSync(require('path').join(__dirname,'../src/utils/intelligenceIncidentResearch.js'),'utf8');
  expect(source).toContain("const researchMethod=providerSearchUsed?'ai_web_search':(packetBacked?'live_web_packet':'ai_web_search');");
});


describe('GDELT HTTP-success rejection handling',()=>{
  test('parses valid GDELT JSON through the bounded text response contract',async()=>{
    const response={
      status:200,
      headers:{get:()=> 'application/json; charset=utf-8'},
      text:jest.fn().mockResolvedValue(JSON.stringify({articles:[{url:'https://news.example/a'}]})),
      json:jest.fn(()=>{throw new Error('must not use implicit JSON parser');})
    };
    await expect(parseGdeltResponse(response)).resolves.toEqual({
      articles:[{url:'https://news.example/a'}]
    });
    expect(response.text).toHaveBeenCalledTimes(1);
    expect(response.json).not.toHaveBeenCalled();
  });

  test('recognizes a plain-text HTTP 200 rejection without logging or returning its body',async()=>{
    const body='Your search was rejected by the upstream service because its query is not accepted.';
    const response={
      status:200,
      headers:{get:()=> 'text/html; charset=UTF-8'},
      text:jest.fn().mockResolvedValue(body)
    };
    let thrown;
    try{await parseGdeltResponse(response);}catch(error){thrown=error;}
    expect(thrown).toMatchObject({
      failureClass:'upstream_protocol',
      upstreamStatus:200,
      upstreamContentType:'text/html'
    });
    expect(thrown.message).toBe('GDELT returned a non-JSON response (HTTP 200, content-type text/html)');
    expect(thrown.message).not.toContain('rejected by the upstream service');
  });

  test('classifies explicit throttling notices separately from malformed/query responses',async()=>{
    const response={
      status:200,
      headers:{get:()=> 'text/plain'},
      text:jest.fn().mockResolvedValue('Rate limit reached. Please try again later.')
    };
    await expect(parseGdeltResponse(response)).rejects.toMatchObject({
      failureClass:'rate_limited',
      upstreamStatus:200,
      upstreamContentType:'text/plain'
    });
  });

  test('backs off GDELT transport timeouts instead of retrying once per incident',async()=>{
    let gdeltRequests=0;
    safeFetchPublicResearch.mockImplementation(async url=>{
      const parsed=new URL(String(url));
      if(parsed.hostname==='api.gdeltproject.org'){
        gdeltRequests++;
        throw Object.assign(new Error('External research request timed out'),{failureClass:'unavailable'});
      }
      return {
        ok:true,
        status:200,
        url:parsed.toString(),
        headers:{get:()=> 'application/rss+xml'},
        text:async()=> '<rss><channel></channel></rss>',
      };
    });

    const first={id:'gdelt-timeout-1',headline:'Test route disruption one',brief:'A bounded test incident.',country_code:'KE',evidence:[]};
    const second={id:'gdelt-timeout-2',headline:'Test route disruption two',brief:'A separate bounded test incident.',country_code:'KE',evidence:[]};
    await researchPublicationIncidents([first],{country:'KE'});
    await researchPublicationIncidents([second],{country:'KE'});

    expect(gdeltRequests).toBe(1);
  });

  test('does not leak upstream response content when the body cannot be read',async()=>{
    const response={
      status:200,
      headers:{get:()=> 'application/json'},
      text:jest.fn().mockRejectedValue(new Error('sensitive upstream response detail'))
    };
    let thrown;
    try{await parseGdeltResponse(response);}catch(error){thrown=error;}
    expect(thrown).toMatchObject({failureClass:'upstream_protocol',upstreamStatus:200});
    expect(thrown.message).not.toContain('sensitive upstream response detail');
  });
});

test('provider-outage fallback dossiers stay differentiated enough to pass the cross-incident boilerplate audit',async()=>{
  const aiClient=require('../src/utils/aiClient');
  aiClient.hasAnyProvider.mockReturnValue(false);
  const events=[
    {id:'fallback-a',headline:'Armed attack closes the northern freight approach',country_code:'KE',region:'Kisumu',severity:'HIGH',intelligence_type:'SECURITY',key_facts:[],caveats:['Evidence coverage is limited to the sources linked to this event in Sonalit. Unresolved details are retained as intelligence gaps rather than filled with assumption.','Authorities have not confirmed when the Kisumu approach reopened.'],why_it_matters:[],evidence:[]},
    {id:'fallback-b',headline:'Port access interrupted after dockside violence',country_code:'KE',region:'Mombasa',severity:'HIGH',intelligence_type:'SECURITY',key_facts:[],caveats:['Evidence coverage is limited to the sources linked to this event in Sonalit. Unresolved details are retained as intelligence gaps rather than filled with assumption.','The duration of the Mombasa port access interruption remains unconfirmed.'],why_it_matters:[],evidence:[]},
    {id:'fallback-c',headline:'Fuel convoy delayed by reported road blockade',country_code:'KE',region:'Nakuru',severity:'MODERATE',intelligence_type:'LOGISTICS',key_facts:[],caveats:['Evidence coverage is limited to the sources linked to this event in Sonalit. Unresolved details are retained as intelligence gaps rather than filled with assumption.','The extent of the reported Nakuru blockade has not been independently confirmed.'],why_it_matters:[],evidence:[]}
  ];
  const result=await researchPublicationIncidents(events,{country:'KE'});
  const dossiers=events.map(event=>{
    const agent=result.byEvent[String(event.id)].agent;
    return {event_id:String(event.id),what_happened:agent.narrative,context:agent.context,assessment:agent.analytical_assessment};
  });
  const audit=auditPublicationContent(dossiers);
  expect(result.summary.provider_unavailable).toBe(true);
  expect(dossiers.every(d=>d.what_happened.length>=260)).toBe(true);
  expect(audit.passed).toBe(true);
  expect(audit.boilerplate_hits).toBe(0);
  expect(audit.duplicate_sentence_count).toBe(0);
  expect(audit.near_duplicate_sentence_count).toBe(0);
  expect(audit.repeated_template_count).toBe(0);
});
