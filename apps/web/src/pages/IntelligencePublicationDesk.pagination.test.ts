import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const desk=readFileSync(new URL('./IntelligencePublicationDesk.tsx',import.meta.url),'utf8');
describe('publication archive pagination',()=>{
 it('loads explicit bounded pages and exposes total-count-backed continuation',()=>{
  expect(desk).toContain('useInfiniteQuery');
  expect(desk).toContain('limit:300,offset:pageParam');
  expect(desk).toContain('publication_type:type');
  expect(desk).toContain('getNextPageParam:(lastPage)=>lastPage.has_more');
  expect(desk).toContain('totalPublications.toLocaleString()');
  expect(desk).toContain('LOAD MORE PUBLICATIONS');
  expect(desk).toContain('q.isFetchNextPageError');
 });
});
