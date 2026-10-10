'use strict';
const fs=require('fs');
const path=require('path');
describe('intelligence publications archive pagination',()=>{
 test('the tenant-scoped register exposes a count, type filter, bounded limit and continuation',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/routes/intelligenceOperations.js'),'utf8');
  const route=source.slice(source.indexOf("router.get('/publications'"),source.indexOf("router.get('/watchlists'"));
  expect(route).toContain('publicationType=req.query.publication_type||null');
  expect(route).toContain('Math.min(300,Math.max(1,Number(req.query.limit)||100))');
  expect(route).toContain('Number(req.query.offset)||0');
  expect(route).toContain('COUNT(*)::int AS total_count');
  expect(route).toContain('has_more:offset+safeRows.length<totalCount');
  expect(route).toContain('req.user.org_id');
 });
});
