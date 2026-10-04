const fs=require('fs');
const path=require('path');

describe('publication PDF UI controls',()=>{
  test('communications publication dossier retrieves PDFs through the authenticated API client',()=>{
    const s=fs.readFileSync(path.join(__dirname,'../../apps/web/src/pages/CommunicationsPublications.jsx'),'utf8');
    expect(s).toContain('openPublicationPdf');
    expect(s).toContain('Preview PDF');
    expect(s).toContain('Download PDF');
    expect(s).not.toContain('href={pdfPreview}');
    expect(s).not.toContain('href={pdfDownload}');
  });
  test('intelligence desk retrieves PDFs through the authenticated API client',()=>{
    const s=fs.readFileSync(path.join(__dirname,'../../apps/web/src/pages/IntelligencePublicationDesk.tsx'),'utf8');
    expect(s).toContain('openPublicationPdf');
    expect(s).toContain('PREVIEW PDF');
    expect(s).toContain('DOWNLOAD PDF');
    expect(s).not.toContain('href={apiBase');
  });
  test('shared publication PDF client uses an authenticated blob request',()=>{
    const s=fs.readFileSync(path.join(__dirname,'../../apps/web/src/lib/publicationPdf.ts'),'utf8');
    expect(s).toContain("api.get(");
    expect(s).toContain("responseType: 'blob'");
    expect(s).toContain("/admin/communications/publications/");
    expect(s).toContain('URL.createObjectURL');
  });
  test('PDF API delegates to the tenant-scoped streaming service instead of redirecting to R2',()=>{
    const route=fs.readFileSync(path.join(__dirname,'../src/routes/communicationsControl.js'),'utf8');
    const service=fs.readFileSync(path.join(__dirname,'../src/services/intelligencePublicationPdf.js'),'utf8');
    expect(route).toContain('streamPublicationPdf');
    expect(service).toContain("Content-Disposition");
    expect(service).toContain("Content-Type','application/pdf'");
    expect(service).toContain('body.pipe(res)');
    expect(service).not.toContain('res.redirect(302, url)');
  });
});
