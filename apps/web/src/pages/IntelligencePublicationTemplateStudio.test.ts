import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const desk=readFileSync(new URL('./IntelligencePublicationDesk.tsx',import.meta.url),'utf8');
const studio=readFileSync(new URL('./IntelligencePublicationTemplateStudio.tsx',import.meta.url),'utf8');
const template=readFileSync(new URL('../templates/intelligence-publication-template.html',import.meta.url),'utf8');
describe('Intel Hub publication template studio integration',()=>{
 it('launches in the governed publication desk with lazy loading',()=>{expect(desk).toContain("lazy(() => import('./IntelligencePublicationTemplateStudio.tsx'))");expect(desk).toContain('OPEN TEMPLATE STUDIO');expect(desk).toContain('USE PUBLICATION TEMPLATE')});
 it('isolates the editor and accepts only parent-window imports',()=>{expect(studio).toContain('sandbox="allow-scripts allow-downloads allow-modals"');expect(template).toContain('event.source!==window.parent');expect(template).toContain("message.type!=='SONALIT_TEMPLATE_IMPORT_V1'");expect(template).toContain('el.textContent=value')});
 it('never turns the local authoring preview into an official release',()=>{expect(studio).toContain('does not update the publication record');expect(studio).toContain('official PDF');expect(template).toContain('TEMPLATE STUDIO PREVIEW · NOT AN OFFICIAL RELEASE');expect(template).toContain('markPreflightStale()');expect(studio).not.toContain('api.post(');expect(studio).not.toContain('api.patch(')});
});
