import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const typography = read('../../styles/sonalit-typography-motion.css');
const entry = read('../../main.tsx');

describe('Sonalit typography and motion contract', () => {
  it('loads bundled, consistent reading, display and telemetry font families globally', () => {
    expect(entry).toContain("import './styles/sonalit-typography-motion.css'");
    expect(typography).toContain("'Archivo'");
    expect(typography).toContain("'Space Grotesk'");
    expect(typography).toContain("'IBM Plex Mono'");
    expect(typography).toContain('font-weight: 500');
    expect(typography).toContain('font-weight: 700');
  });

  it('prevents ultra-light utility weights and microscopic utility labels', () => {
    expect(typography).toContain('.font-thin, .font-extralight, .font-light, .font-normal');
    expect(typography).toContain('font-weight: 500 !important');
    expect(typography).toContain('font-size: 11px !important');
  });

  it('raises E-Lock device identity, status, battery and telemetry to readable sizes and weights', () => {
    for (const rule of [
      '.cds-lock-device__top small',
      '.cds-lock-device__top > div > b',
      '.cds-lock-health',
      '.cds-lock-battery__reading',
      '.cds-lock-device__telemetry > div > small',
      '.cds-lock-device__telemetry > div > b',
      '.cds-lock-device__assignment span',
      '.cds-lock-device > footer',
      '.cds-lock-dossier__fields b',
    ]) {
      expect(typography).toContain(rule);
    }
    expect(typography).toContain('font: 700 15px/1.25 var(--sonalit-font-display)');
    expect(typography).toContain('font: 700 11px/1.3 var(--sonalit-font-data)');
  });

  it('adds purposeful card and chart motion while respecting reduced-motion preferences', () => {
    expect(typography).toContain('@keyframes sonalit-lock-card-arrive');
    expect(typography).toContain('animation: sonalit-lock-card-arrive');
    expect(typography).toContain('transform: translateY(-1px)');
    expect(typography).toContain('@media (prefers-reduced-motion: reduce)');
    expect(typography).toContain('animation: none !important');
  });
});
