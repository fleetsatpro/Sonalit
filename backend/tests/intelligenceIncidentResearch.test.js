jest.mock('../src/utils/aiClient',()=>({
  hasAnyProvider:jest.fn(()=>false),
  hasReadyProvider:jest.fn(()=>false),
  createResearchMessage:jest.fn(),
}));

jest.mock('../src/utils/publicResearchFetch',()=>({
  safeFetchPublicResearch:jest.fn(),
  MAX_RESPONSE_BYTES:2*1024*1024,
}));

const { researchPublicationIncidents, verifiedResponseSources } = require('../src/utils/intelligenceIncidentResearch');
const { safeFetchPublicResearch } = require('../src/utils/publicResearchFetch');

test('passes publication data-classification policy into AI incident research',async()=>{
  const aiClient=require('../src/utils/aiClient');
  process.env.INTEL_PUBLICATION_DATA_CLASSIFICATION='public';
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
  expect(result.byEvent['i-policy'].agent.provider).toBe('openrouter-free-router');
});

describe('publication incident research coverage',()=>{
  beforeEach(()=>{
    safeFetchPublicResearch.mockReset();
    safeFetchPublicResearch.mockResolvedValue({
      ok:true,
      status:200,
      url:'https://news.google.com/rss/search',
      headers:{get:()=> 'application/rss+xml'},
      text:async()=>'<rss><channel></channel></rss>',
      json:async()=>({articles:[]})
    });
  });
  afterEach(()=>{delete global.fetch});
  test('does not skip research just because configured providers are temporarily cooling down',async()=>{
    const aiClient=require('../src/utils/aiClient');
    process.env.INTEL_PUBLICATION_DATA_CLASSIFICATION='public';
    aiClient.hasAnyProvider.mockReset().mockReturnValue(true);
    aiClient.hasReadyProvider.mockReset().mockReturnValue(false);
    aiClient.createResearchMessage.mockReset().mockResolvedValue({
      _provider:'openrouter-free-router',
      content:[{type:'text',text:JSON.stringify({results:[]})}]
    });
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
