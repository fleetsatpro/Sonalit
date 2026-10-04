jest.mock('../src/utils/aiClient',()=>({hasAnyProvider:()=>false}));

const { researchPublicationIncidents } = require('../src/utils/intelligenceIncidentResearch');

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
