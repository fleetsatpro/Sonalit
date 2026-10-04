jest.mock('../src/utils/aiClient',()=>({hasAnyProvider:()=>false}));

const { researchPublicationIncidents } = require('../src/utils/intelligenceIncidentResearch');

describe('degraded incident research remains useful',()=>{
  afterEach(()=>{delete global.fetch});
  test('turns live web research into a substantive dossier when no model provider is available',async()=>{
    global.fetch=jest.fn(async(url)=>{
      const value=String(url);
      if(value.startsWith('https://news.google.com/rss/search')){
        return {
          ok:true,
          headers:{get:()=> 'application/rss+xml'},
          text:async()=>'<rss><channel><item><title>Independent report on the incident</title><link>https://example.com/report</link><pubDate>Sat, 04 Oct 2026 08:00:00 GMT</pubDate><source>Example News</source><description><![CDATA[Local reporting describes a temporary disruption on the corridor and notes that authorities responded while the full duration remained unclear.]]></description></item></channel></rss>'
        };
      }
      return {
        ok:true,
        headers:{get:()=> 'text/html'},
        text:async()=>'<html><head><title>Independent report on the incident</title><meta name="description" content="Local reporting describes a temporary disruption on the corridor and notes that authorities responded while the full duration remained unclear."></head><body><main><p>The report places the incident on the affected corridor and describes a temporary disruption. It also records that authorities responded and that the precise duration was not yet established.</p></main></body></html>'
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
    expect(result.summary.web_sources_retrieved).toBeGreaterThanOrEqual(1);
    expect(dossier.agent.research_method).toBe('live_web_packet');
    expect(dossier.agent.agent_status).toBe('provider_unavailable');
    expect(dossier.agent.narrative.length).toBeGreaterThan(220);
    expect(dossier.agent.sources.length).toBeGreaterThanOrEqual(1);
  });
});
