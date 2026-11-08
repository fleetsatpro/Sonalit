import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const page = read('./pages.tsx');
const dashboard = read('./CDSDashboard.tsx');
const constants = read('./constants.ts');
const visual = read('./CDSPerformanceAnalysis.css');

describe('CDS Performance Analysis experience contract', () => {
  it('renames the module consistently in navigation and the module heading', () => {
    expect(constants).toContain("label: 'Performance Analysis'");
    expect(constants).not.toContain("label: 'Performance Intelligence'");
    expect(dashboard).toContain('PERFORMANCE ANALYSIS / OPERATIONAL EVIDENCE');
    expect(page).toContain('Performance, <span className="text-cds-orange">made intelligible.</span>');
  });

  it('derives analytical signals from persisted daily, ETA, partner and operator records', () => {
    for (const marker of ['peakBookingDay', 's.eta_observed', 'topPartner.containers_handled', 'topOperator.clamp_actions', 'data.operator_leaderboard']) {
      expect(page).toContain(marker);
    }
    expect(page).toContain('No ETA baseline in the selected period');
    expect(page).toContain('No partner handling volume recorded');
  });

  it('supports interactive single-series and combined trend inspection', () => {
    expect(page).toContain('setTrendMetric(option.id)');
    expect(page).toContain('aria-label="Choose activity series"');
    expect(page).toContain('visibleSeries.map');
    expect(page).toContain('selectedTrendValues');
  });

  it('adds spatial card, signal, chart and section motion with reduced-motion support', () => {
    for (const marker of ['@keyframes cpa-card-arrive', '@keyframes cpa-section-arrive', '@keyframes cpa-orbit', '.cpa-kpi:hover', '.cpa-insight:hover', '@media (prefers-reduced-motion: reduce)', 'animation: none !important']) {
      expect(visual).toContain(marker);
    }
  });
});
