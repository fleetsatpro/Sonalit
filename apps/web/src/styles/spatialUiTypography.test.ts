import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./spatial-command.css', import.meta.url), 'utf8');

describe('spatial command readability', () => {
  it('keeps primary telemetry labels legible without changing map/media layers', () => {
    expect(css).toMatch(/\.spatial-brand-kicker\s*\{[^}]*font-size:\s*9px/s);
    expect(css).toMatch(/\.spatial-panel-header\s*\{[^}]*font-size:\s*9px/s);
    expect(css).toMatch(/\.spatial-panel-subtitle\s*\{[^}]*font-size:\s*9px/s);
    expect(css).toMatch(/\.spatial-metric-label\s*\{[^}]*font:\s*700\s+9px/s);
    expect(css).toMatch(/\.spatial-chip\s*\{[^}]*font:\s*700\s+9px/s);
  });

  it('does not shrink the mobile live badge or view controls below the desktop readable size', () => {
    expect(css).toContain('.spatial-live-indicator { padding: 4px 7px; font-size: 9px; }');
    expect(css).toContain('.spatial-view-button { min-height: 44px; padding-inline: 9px; font-size: 9px; }');
  });
});
