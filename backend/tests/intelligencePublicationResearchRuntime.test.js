const fs=require('fs');
const path=require('path');

describe('publication deep-research runtime ordering',()=>{
  const source=()=>fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');
  test('defines the publication incident set before invoking research',()=>{
    const s=source();
    const subset=s.indexOf('const publicationEvents=selectPublicationResearchEvents(events,10);');
    const research=s.indexOf('researchPublicationIncidents(publicationEvents',{});
    expect(subset).toBeGreaterThan(-1);
    expect(research).toBeGreaterThan(subset);
  });
  test('legacy publications without complete research are not returned as unchanged',()=>{
    const s=source();
    const needs=s.indexOf('const needsDeepResearch=');
    const unchanged=s.indexOf('const unchanged=');
    const early=s.indexOf("if(existing.length&&unchanged)return");
    expect(needs).toBeGreaterThan(-1);
    expect(unchanged).toBeGreaterThan(needs);
    expect(early).toBeGreaterThan(unchanged);
    expect(s.slice(unchanged,early)).toContain('&& !needsDeepResearch');
  });
  test('research telemetry exposes web-search request count',()=>{
    const s=source();
    expect(s).toContain('web_search_requests=');
  });
});
