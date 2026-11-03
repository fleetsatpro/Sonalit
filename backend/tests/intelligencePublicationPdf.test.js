const fs=require('fs');
const path=require('path');

describe('ultra publication PDF invariants',()=>{
  const source=()=>fs.readFileSync(path.join(__dirname,'../src/services/intelligencePublicationPdf.js'),'utf8');
  test('uses high-resolution geospatial artwork and research dossier layout',()=>{
    const s=source();
    expect(s).toContain('const W=2400,H=1440,pad=140');
    expect(s).toContain("title('CONTENTS'");
    expect(s).toContain("title('RESEARCH & CORROBORATION'");
    expect(s).toContain("title('INCIDENT RESEARCH DOSSIER'");
    expect(s).toContain("title('VISUAL INTELLIGENCE'");
    expect(s).toContain('function researchChain');
    expect(s).toContain('function timeline');
  });
  test('supports attachment disposition for explicit downloads',()=>{
    const s=source();
    expect(s).toContain('ResponseContentDisposition');
    expect(s).toContain('attachment; filename=');
  });
  test('stores provenance-linked research images when available',()=>{
    const s=source();
    expect(s).toContain('fetchImages(rows,researchSources=[])');
    expect(s).toContain('researchSources');
  });

  test('successful regeneration stamps the renderer version checked by PDF delivery',()=>{
    const s=source();
    const ready=s.slice(s.indexOf("UPDATE intel_publications SET pdf_status='ready'"),s.indexOf("UPDATE intel_publications SET pdf_status='ready'")+850);
    expect(ready).toContain("body=jsonb_set(COALESCE(body,'{}'::jsonb),'{generator}'");
    expect(ready).toContain("jsonb_build_object('pdf_renderer_version',$4::text)");
    expect(ready).toContain('key,PDF_RENDERER_VERSION');
    expect(s).toContain("row.body?.generator?.pdf_renderer_version||'')!==PDF_RENDERER_VERSION");
  });
  test('missing stored PDF objects become retryable instead of remaining falsely ready',()=>{
    const s=source();
    const start=s.indexOf('async function getPublicationPdfObjectUnsafe');
    const end=s.indexOf('async function getPublicationPdfObject(orgId,publicationId)',start);
    const access=s.slice(start,end);
    expect(access).toContain('publication_pdf_object_not_found');
    expect(access).toContain("SET pdf_status='failed',pdf_error=$3,updated_at=NOW()");
    expect(access).toContain("AND status='published' AND pdf_status='ready' AND pdf_key=$4");
    expect(s).toContain("pdf_error LIKE 'Publication PDF object not found%'");
  });
});
