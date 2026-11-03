const fs=require('fs');
const path=require('path');

function retiredToken(){return String.fromCharCode(51,73)}
function scan(pathname){return fs.readFileSync(path.join(__dirname,'../..',pathname),'utf8')}

describe('publication brand guard',()=>{
  test('retired publication label is absent from human-facing intelligence surfaces',()=>{
    const token=retiredToken();
    const tokenRe=new RegExp('\\b'+token+'\\b','i');
    const surfaces=[
      'apps/web/src/pages/IntelligencePublicationDesk.tsx',
      'apps/web/src/pages/IntelligenceCentreSynthesis.tsx',
      'backend/src/services/intelligencePublicationPdf.js',
      'backend/src/utils/intelligencePublicationBuilder.js'
    ];
    for(const surface of surfaces)expect(scan(surface)).not.toMatch(tokenRe);
  });
  test('brand cleanup migration exists and invalidates cached PDFs',()=>{
    const migration=fs.readFileSync(path.join(__dirname,'../migrations/20261004_003_publication_brand_cleanup.sql'),'utf8');
    expect(migration).toContain("pdf_status = 'not_requested'");
    expect(migration).toContain('pdf_key = NULL');
    expect(migration).toContain('pdf_generated_at = NULL');
  });
});
