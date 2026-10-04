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
  test('PDF API streams the tenant-scoped object instead of redirecting to R2',()=>{
    const s=fs.readFileSync(path.join(__dirname,'../src/routes/communicationsControl.js'),'utf8');
    expect(s).toContain('getPublicationPdfObject');
    expect(s).toContain("Content-Disposition");
    expect(s).toContain("Content-Type','application/pdf'");
    expect(s).toContain('body.pipe(res)');
    expect(s).not.toContain('res.redirect(302, url)');
  });
});
