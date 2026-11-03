import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const shell = read('./IntelligenceCentre.jsx');
const alerts = read('./IntelligenceAlerts.tsx');
const newsroom = read('./IntelligenceLiveNews.jsx');

describe('Intel Hub health-truth contract', () => {
  it('does not present an unconditional green live claim from the root shell', () => {
    expect(shell).toContain('COLLECTION HEALTH: PER MODULE');
    expect(shell).not.toContain('COLLECTION FABRIC <b>LIVE</b>');
    expect(shell).not.toContain('<span className="live-dot"/> COLLECTION FABRIC');
  });

  it('distinguishes alert API failure from a genuinely empty signal window', () => {
    expect(alerts).toContain("useState<'CHECKING'|'RESPONDING'|'DEGRADED'>('CHECKING')");
    expect(alerts).toContain("setRequestState('RESPONDING')");
    expect(alerts).toContain("setRequestState('DEGRADED')");
    expect(alerts).toContain("if(!Array.isArray(a.data?.alerts))throw new Error('invalid_alerts_payload')");
    expect(alerts).toContain('ALERT QUERY FAILED — INCIDENT STATE UNKNOWN');
    expect(alerts).toContain('An empty result is not evidence of zero incidents');
    expect(alerts).not.toContain("loading?'SYNCING':'LIVE'");
  });

  it('describes collection endpoint response state rather than claiming every response is live', () => {
    expect(newsroom).toContain("useState('CHECKING')");
    expect(newsroom).toContain("setStatus('RESPONDING')");
    expect(newsroom).toContain("setStatus('DEGRADED')");
    expect(newsroom).toContain("if(!Array.isArray(news?.observations))throw new Error('invalid_observations_payload')");
    expect(newsroom).toContain("'API RESPONDING'");
    expect(newsroom).not.toContain("setStatus('LIVE')");
    expect(newsroom).not.toContain("'CONTINUOUS'"); // browser refresh is not proof of continuous upstream collection
  });
});
