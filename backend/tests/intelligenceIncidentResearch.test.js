jest.mock('../src/utils/aiClient',()=>({hasAnyProvider:()=>false}));

const { researchPublicationIncidents, verifiedResponseSources } = require('../src/utils/intelligenceIncidentResearch');

describe('publication incident research coverage',()=>{
  beforeEach(()=>{
    global.fetch=jest.fn(async()=>({
      ok:true,
      headers:{get:()=> 'application/rss+xml'},
      text:async()=>'<rss><channel></channel></rss>'
    }));
  });
  afterEach(()=>{delete global.fetch});
  test('attempts a research packet for every incident, not only top-ranked incidents',async()=>{
    const events=[
      {id:'i1',headline:'Incident one',brief:'First incident',country_code:'KE',evidence:[]},
      {id:'i2',headline:'Incident two',brief:'Second incident',country_code:'KE',evidence:[]},
      {id:'i3',headline:'Incident three',brief:'Third incident',country_code:'KE',evidence:[]},
      {id:'i4',headline:'Incident four',brief:'Fourth incident',country_code:'KE',evidence:[]},
      {id:'i5',headline:'Incident five',brief:'Fifth incident',country_code:'KE',evidence:[]}
    ];
    const result=await researchPublicationIncidents(events,{country:'KE'});
    expect(result.summary.requested).toBe(5);
    expect(Object.keys(result.byEvent)).toEqual(expect.arrayContaining(events.map(e=>e.id)));
    expect(result.summary.fallback).toBe(5);
    expect(global.fetch).toHaveBeenCalled();
  });
});


test('provider research citations must come from verified web-search evidence',()=>{
  const sources=verifiedResponseSources({
    content:[
      {
        type:'text',
        text:'{"sources":[{"url":"https://invented.example/report"},{"url":"https://real.example/report"}]}',
        citations:[{type:'web_search_result_location',url:'https://real.example/report',title:'Verified report',cited_text:'Verified source text'}]
      },
      {type:'web_search_tool_result',content:[
        {type:'web_search_result',title:'Verified report',url:'https://real.example/report',domain:'real.example'}
      ]}
    ]
  });
  expect(sources.map(x=>x.url)).toEqual(['https://real.example/report']);
  expect(sources[0].source_type).toBe('provider_web_citation');
});


test('successful researched incidents persist an explicit research method',()=>{
  const source=require('fs').readFileSync(require('path').join(__dirname,'../src/utils/intelligenceIncidentResearch.js'),'utf8');
  expect(source).toContain("const researchMethod=providerSearchUsed?'ai_web_search':(packetBacked?'live_web_packet':'ai_web_search');");
});
