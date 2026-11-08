import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const design = read('./CDSDesignSystem.css');
const polish = read('./CDSOperationalPolish.css');
const html = read('../../../index.html');

describe('CDS typography legibility contract', () => {
  it('loads the actual reading face as a variable font and applies it to the CDS shell', () => {
    expect(html).toContain('family=Inter:wght@400..900');
    expect(design).toContain("font-family: 'Inter', system-ui, -apple-system, sans-serif;");
    expect(design).toContain('font-weight: 550;');
    expect(design).toContain('-webkit-font-smoothing: auto;');
    expect(design).not.toContain("'Archivo'");
    expect(design).not.toContain("'Sora'");
  });

  it('uses a heavier dedicated display face with readable weight steps', () => {
    expect(html).toContain('family=Syne:wght@400..800');
    expect(design).toContain("font-family: 'Syne', 'Space Grotesk', system-ui, sans-serif;");
    expect(polish).toContain("font-family: 'Syne', 'Space Grotesk', sans-serif;");
    expect(design).toContain('.cds-shell .font-normal { font-weight: 550 !important; }');
    expect(design).toContain('.cds-shell .font-medium { font-weight: 600 !important; }');
    expect(design).toContain('.cds-shell .font-semibold { font-weight: 650 !important; }');
    expect(design).toContain('font-synthesis: weight;');
  });
});
