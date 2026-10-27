import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildTemplatePayload } from './IntelligencePublicationTemplateStudio';
const desk=readFileSync(new URL('./IntelligencePublicationDesk.tsx',import.meta.url),'utf8');
const studio=readFileSync(new URL('./IntelligencePublicationTemplateStudio.tsx',import.meta.url),'utf8');
const template=readFileSync(new URL('../templates/intelligence-publication-template.html',import.meta.url),'utf8');
describe('Intel Hub publication template studio integration',()=>{
 it('launches in the governed publication desk with lazy loading',()=>{expect(desk).toContain("lazy(() => import('./IntelligencePublicationTemplateStudio.tsx'))");expect(desk).toContain('OPEN TEMPLATE STUDIO');expect(desk).toContain('USE PUBLICATION TEMPLATE')});
 it('isolates the editor and accepts only parent-window imports',()=>{expect(studio).toContain('sandbox="allow-scripts allow-downloads allow-modals"');expect(template).toContain('event.source!==window.parent');expect(template).toContain("message.type!=='SONALIT_TEMPLATE_IMPORT_V1'");expect(template).toContain('el.textContent=value');expect(template).toContain("if(fam==='weekly'){");expect(template).toContain("if(fam==='monthly'){");expect(template).toContain("if(fam==='trends'){");expect(template).toContain('NO COMPATIBLE TEMPLATE FAMILY')});
 it('never turns the local authoring preview into an official release',()=>{expect(studio).toContain('does not update the publication record');expect(studio).toContain('official PDF');expect(template).toContain('TEMPLATE STUDIO PREVIEW · NOT AN OFFICIAL RELEASE');expect(template).toContain('markPreflightStale()');expect(studio).not.toContain('api.post(');expect(studio).not.toContain('api.patch(')});
});

describe('publication record mapping',()=>{
 it('maps only present source-backed fields and preserves list content',()=>{
  const payload=buildTemplatePayload({
   id:'publication-123',status:'draft',publication_type:'weekly',country_code:'KE',
   period_start:'2026-10-01T21:00:00.000Z',period_end:'2026-10-02T21:00:00.000Z',
   executive_assessment:'Decision-relevant assessment.',
   body:{
    handling:{level:'AMBER'},
    threat_posture:{level:'HIGH',counts:{critical:1,high:2}},
    collection_basis:{basis:'Independent source corroboration',full_period_event_count:3},
    incident_dossiers:[{event_id:'evt-1',headline:'Verified incident',why_it_matters:['Protect exposed route','Review operating window']}],
    references:[{source:'Official bulletin',title:'Situation update',url:'https://example.org/update'}],
    outlook:['Monitor the stated indicator.'],intelligence_gaps:[]
   }
  });
  expect(payload).toMatchObject({
   publicationId:'publication-123',publicationStatus:'draft',country:'KE',tlp:'AMBER',
   threatLevel:'HIGH',collectionBasis:'Independent source corroboration',eventCount:'3',
   executiveAssessment:'Decision-relevant assessment.',outlook:['Monitor the stated indicator.']
  });
  expect(payload?.incidents[0].whyItMatters).toBe('Protect exposed route · Review operating window');
  expect(payload?.references[0].url).toBe('https://example.org/update');
  expect(payload?.severityCounts).toEqual({critical:'1',high:'2'});
 });
 it('does not invent missing publication metrics, classifications, references or severity counts',()=>{
  const payload=buildTemplatePayload({id:'minimal-publication',publication_type:'weekly',body:{}});
  expect(payload?.eventCount).toBe('');
  expect(payload?.tlp).toBe('');
  expect(payload?.threatLevel).toBe('');
  expect(payload?.severityCounts).toEqual({});
  expect(payload?.references).toEqual([]);
  expect(payload?.incidents).toEqual([]);
 });
});

describe('publication family compatibility',()=>{
 it('does not relabel daily publications as a weekly report',()=>{
  const payload=buildTemplatePayload({
   id:'daily-123',status:'draft',publication_type:'daily',country_code:'KE',
   body:{collection_basis:{full_period_event_count:12,basis:'Recorded daily event ledger'},threat_posture:{level:'HIGH',counts:{critical:2}},incident_dossiers:[{event_id:'evt-daily',headline:'Daily development'}]}
  });
  expect(payload?.family).toBe('all');
  expect(payload?.eventCount).toBe('12');
  expect(payload?.incidents[0]?.headline).toBe('Daily development');
  expect(studio).toContain("type==='weekly'?'weekly':'all'");
 });
 it('maps only explicit weekly, monthly and trends records to the matching family',()=>{
  expect(buildTemplatePayload({id:'weekly',publication_type:'weekly',body:{}})?.family).toBe('weekly');
  expect(buildTemplatePayload({id:'monthly',publication_type:'monthly',body:{}})?.family).toBe('monthly');
  expect(buildTemplatePayload({id:'trends',publication_type:'weekly_trends',body:{}})?.family).toBe('trends');
  expect(buildTemplatePayload({id:'route',publication_type:'route_assessment',body:{}})?.family).toBe('all');
 });
});

it('declares shared findings before family-specific mapping blocks',()=>{
 const shared=template.indexOf('const findings=Array.isArray(raw.findings)?raw.findings.slice(0,3):[]');
 const weekly=template.indexOf("if(fam==='weekly'){");
 expect(shared).toBeGreaterThanOrEqual(0);
 expect(shared).toBeLessThan(weekly);
});
