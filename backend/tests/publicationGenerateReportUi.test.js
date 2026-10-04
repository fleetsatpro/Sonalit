const fs=require('fs');
const path=require('path');

describe('on-demand publication report flow',()=>{
  test('communications route exposes an explicit generate-report endpoint',()=>{
    const s=fs.readFileSync(path.join(__dirname,'../src/routes/communicationsControl.js'),'utf8');
    expect(s).toContain("router.post('/publications/:id/generate-report'");
    expect(s).toContain("renderAndStorePublicationPdf(req.user.org_id, String(req.params.id))");
  });
  test('communications publication UI labels the action Generate/Regenerate report',()=>{
    const s=fs.readFileSync(path.join(__dirname,'../../apps/web/src/pages/CommunicationsPublications.jsx'),'utf8');
    expect(s).toContain('Generate report');
    expect(s).toContain('Regenerate report');
    expect(s).toContain('/generate-report');
  });
  test('intelligence newsroom exposes on-demand report generation and research signals',()=>{
    const s=fs.readFileSync(path.join(__dirname,'../../apps/web/src/pages/IntelligencePublicationDesk.tsx'),'utf8');
    expect(s).toContain('/generate-report');
    expect(s).toContain('GENERATE REPORT');
    expect(s).toContain('dr.incidents_researched??dr.incidents_web_researched');
    expect(s).toContain('researchCoverage(x)>0');
    expect(s).toContain('REGENERATE REPORT');
    expect(s).toContain('incidents_researched');
    expect(s).toContain('web_sources_discovered');
  });
});
