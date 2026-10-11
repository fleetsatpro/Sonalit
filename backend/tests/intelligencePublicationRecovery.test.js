'use strict';

const fs=require('fs');
const path=require('path');

describe('intelligence publication autonomous recovery',()=>{
  test('publication generation can reconstruct the original closed reporting period',()=>{
    const s=fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');
    expect(s).toContain("async function publicationForCountryUnsafe(orgId,country,type='daily',options={})");
    expect(s).toContain("const now=options.now instanceof Date?options.now:new Date();");
    expect(s).toContain("const anchorNow=new Date(periodEnd.getTime()-1000);");
    expect(s).toContain("forceResearch:true,recovery:true");
  });

  test('stalled publication recovery is bounded and cluster-locked',()=>{
    const s=fs.readFileSync(path.join(__dirname,'../src/utils/intelligenceAgents.js'),'utf8');
    expect(s).toContain("async function recoverStalledPublications(orgId,now=new Date(),options={})");
    expect(s).toContain("updated_at < NOW()-($3::int*INTERVAL '1 minute')");
    expect(s).toContain("LIMIT $4");
    expect(s).toContain("status IN ('draft','review')");
  });

  test('worker runs autonomous recovery independently of the midnight boundary',()=>{
    const s=fs.readFileSync(path.join(__dirname,'../src/workers/worker.intelligence.js'),'utf8');
    expect(s).toContain("recoverStalledPublications");
    expect(s).toContain("INTEL_PUBLICATION_RECOVERY_INTERVAL_MINUTES || 15");
    expect(s).toContain("sonalit:intelligence:publication-recovery");
    expect(s).toContain("schedulePublicationRecovery();");
  });

  test('PDF backlog repair runs for each tenant independently of draft recovery',()=>{
    const s=fs.readFileSync(path.join(__dirname,'../src/workers/worker.intelligence.js'),'utf8');
    expect(s).toContain('generateMissingPublicationPdfs(org.org_id,pdfBatchSize)');
    expect(s).toContain('const pdfBatchSize=Math.max(1,Math.min(12,Number(process.env.INTEL_PUBLICATION_PDF_BATCH || 8)))');
    expect(s).not.toContain('const published=[]');
  });

  test('PDF rendering uses an atomic lease and fences stale render completion',()=>{
    const s=fs.readFileSync(path.join(__dirname,'../src/services/intelligencePublicationPdf.js'),'utf8');
    const start=s.indexOf('async function renderAndStorePublicationPdfUnsafe');
    const end=s.indexOf('async function getPublicationPdfAccessUrlUnsafe',start);
    const render=s.slice(start,end);
    expect(render).toContain("SET pdf_status='generating'");
    expect(render).toContain("updated_at < NOW()-INTERVAL '30 minutes'");
    expect(render).toContain("'pdf_generation_claim'");
    expect(render).toContain("body->'generator'->>'pdf_generation_claim'=$5");
    expect(render).toContain("body->'generator'->>'pdf_generation_claim'=$4");
    expect(render).toContain("reason:existing.pdf_status==='generating'?'pdf_generation_in_progress'");
    expect(render).toContain("const key=keyPrefix+claimToken+'.pdf'");
    expect(render).toContain("status:'superseded'");
    expect(render).toContain("SET pdf_status='failed',pdf_error=$3,updated_at=NOW()");
  });
});
