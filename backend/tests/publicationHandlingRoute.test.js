'use strict';

const fs=require('fs');
const path=require('path');

describe('publication handling route invariants',()=>{
  test('handling changes are tenant-scoped, reasoned, audited and invalidate derived PDFs',()=>{
    const source=fs.readFileSync(path.join(__dirname,'../src/routes/intelligenceOperations.js'),'utf8');
    const start=source.indexOf("router.patch('/publications/:id/handling'");
    const end=source.indexOf("router.post('/publications/:id/review'",start);
    const route=source.slice(start,end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(route).toContain("WHERE id=$1 AND org_id=$2 FOR UPDATE");
    expect(route).toContain('req.dbTx(async client=>');
    expect(route).toContain('intel_publication_handling_audit');
    expect(route).toContain("pdf_status='not_requested'");
    expect(route).toContain("pdf_key=NULL");
    expect(route).toContain("pdf_version=COALESCE(pdf_version,1)+1");
    expect(route).toContain("reason.length<5||reason.length>1000");
    expect(route).not.toContain("SET status='published'");
  });

  test('the handling audit store is isolated by tenant RLS and records changes immutably',()=>{
    const sql=fs.readFileSync(path.join(__dirname,'../migrations/20261026_001_intelligence_publication_handling.sql'),'utf8');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain("current_setting('app.current_org_id', true)::uuid");
    expect(sql).toContain('previous_handling JSONB');
    expect(sql).toContain('next_handling JSONB NOT NULL');
    expect(sql).toContain('reason TEXT NOT NULL');
  });
});
