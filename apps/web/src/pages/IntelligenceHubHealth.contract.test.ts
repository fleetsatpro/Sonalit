import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const shell = read('./IntelligenceCentre.jsx');
const alerts = read('./IntelligenceAlerts.tsx');
const newsroom = read('./IntelligenceLiveNews.jsx');
const command = read('./IntelligenceCommandView.tsx');
const sourceControl = read('./IntelligenceSourceCommand.tsx');
const rail = read('../components/layout/Rail.tsx');
const router = read('../router.tsx');
const mainEntry = read('../main.tsx');

describe('Intel Hub product and evidence-truth contract', () => {
  it('exposes one command, analysis, collection and dissemination shell', () => {
    for (const module of ['command', 'analysis', 'alerts', 'newsroom', 'collection', 'publications']) expect(shell).toContain("id: '" + module + "'");
    expect(shell).toContain("value === 'core') return 'analysis'");
    expect(mainEntry).toContain("import './styles/intelligence-centre-workspace.css'");
    expect(shell).toContain("import { NavArtwork } from '../components/layout/Rail.js'");
    expect(shell).toContain("art: 'nav-satellite'");
    expect(rail).toContain('export function NavArtwork');
    expect(shell).not.toContain("COLLECTION FABRIC <b>LIVE</b>");
  });

  it('restricts the frontend route to administrators', () => {
    expect(router).toContain('const intelligenceAdminCheck=');
    expect(router).toContain('beforeLoad:intelligenceAdminCheck');
    expect(router).toContain("['admin','super_admin']");
  });

  it('distinguishes alert API failure from an empty signal window', () => {
    expect(alerts).toContain("useState<'CHECKING'|'RESPONDING'|'DEGRADED'>('CHECKING')");
    expect(alerts).toContain("setRequestState('RESPONDING')");
    expect(alerts).toContain("setRequestState('DEGRADED')");
    expect(alerts).toContain("if(!Array.isArray(a.data?.alerts))throw new Error('invalid_alerts_payload')");
    expect(alerts).toContain('ALERT QUERY FAILED — INCIDENT STATE UNKNOWN');
    expect(alerts).toContain('An empty result is not evidence of zero incidents');
    expect(alerts).toContain("a.source_count==null?'—':a.source_count");
    expect(alerts).toContain('RETURNED LEADS · 180M');
    expect(alerts).not.toContain('COLLECTOR<b>5 MIN');
  });

  it('labels Newsroom keyword matching as lexical triage, never assessed severity', () => {
    expect(newsroom).toContain('const triageCue=');
    expect(newsroom).toContain('STRONG TEXT CUE');
    expect(newsroom).toContain('LEXICAL TRIAGE ONLY');
    expect(newsroom).not.toContain('const level=');
    expect(newsroom).not.toContain("return'critical'");
    expect(newsroom).not.toContain('CRITICAL LEADS');
    expect(newsroom).not.toContain("setStatus('LIVE')");
  });

  it('uses persisted source run records and accurately reports manual collection outcomes', () => {
    expect(sourceControl).toContain('const record = run?.health || null');
    expect(sourceControl).toContain('response?.collection');
    expect(sourceControl).not.toContain('response?.started');
    expect(sourceControl).toContain('DISCOVERY / LINK-OUT');
    expect(sourceControl).toContain('AUTHORISED FEED PENDING');
  });

  it('uses server-side window aggregates and keeps event/warning detail separate', () => {
    expect(command).toContain('window_hours: windowHours');
    expect(command).toContain('selectedWarning');
    expect(command).toContain('warningActionsQ');
    expect(command).toContain('source_count');
    expect(command).toContain('healthSources');
    expect(command).toContain('observation_ingestion === false');
  });
});
