const fs=require('fs');
const path=require('path');

describe('publication PDF UI controls',()=>{
  test('communications publication dossier exposes preview and download actions',()=>{
    const s=fs.readFileSync(path.join(__dirname,'../../apps/web/src/pages/CommunicationsPublications.jsx'),'utf8');
    expect(s).toContain('pdfDownload');
    expect(s).toContain('Download PDF');
    expect(s).toContain('download=1');
  });
  test('intelligence desk exposes preview and download actions',()=>{
    const s=fs.readFileSync(path.join(__dirname,'../../apps/web/src/pages/IntelligencePublicationDesk.tsx'),'utf8');
    expect(s).toContain('DOWNLOAD PDF');
    expect(s).toContain('download=1');
  });
});
