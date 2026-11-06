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
const visualSystem = read('../styles/intelligence-centre-premium.css');

describe('Intel Hub product and evidence-truth contract', () => {
  it('exposes one command, analysis, collection and dissemination shell', () => {
    for (const module of ['command', 'analysis', 'alerts', 'newsroom', 'collection', 'publications']) expect(shell).toContain("id: '" + module + "'");
    expect(shell).toContain("value === 'core') return 'analysis'");
    expect(mainEntry).toContain("import './styles/intelligence-centre-workspace.css'");
    expect(shell).toContain("import { NavArtwork } from '../components/layout/Rail.js'");
    expect(shell).toContain("art: 'nav-satellite'");
    expect(rail).toContain('export function NavArtwork');
    expect(shell).not.toContain("COLLECTION FABRIC <b>LIVE</b>");
    expect(rail).toContain("group.items.filter(item => item.path !== '/intelligence'");
  });

  it('restricts the frontend route to administrators', () => {
    expect(router).toContain('const intelligenceAdminCheck=');
    expect(router).toContain('beforeLoad:intelligenceAdminCheck');
    expect(router).toContain("['admin','super_admin']");
    expect(rail).toContain("{path:'/intelligence',art:'nav-analytics',label:'Intelligence Centre'}");
    expect(rail).not.toContain("label:'Legacy Risk Intel'");
    expect(router).toContain("path:'/risk-intel',beforeLoad:()=>{intelligenceAdminCheck();throw redirect({to:'/intelligence',search:{module:'analysis'},replace:true})}");
    expect(router).not.toContain("import('./pages/RiskIntel.js')");
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
    expect(sourceControl).toContain('meta.configured !== true');
  });

  it('ships a unified high-legibility command visual system and genuine basemap selection', () => {
    expect(shell).toContain('<h1>INTEL HUB</h1>');
    expect(mainEntry).toContain("import './styles/intelligence-centre-premium.css'");
    expect(visualSystem).toContain('.sonalit-intelligence-workspace .icv-metric strong');
    expect(visualSystem).toContain('prefers-reduced-motion: reduce');
    expect(visualSystem).toContain('.sonalit-intelligence-workspace .icd-nav button b');
    expect(command).toContain("basemap === 'dark' ? DARK_STREET_STYLE : STREET_STYLE");
    expect(command).toContain('icv-basemap-toggle');
  });

  it('uses server-side window aggregates and keeps event/warning detail separate', () => {
    expect(command).toContain('window_hours: windowHours');
    expect(command).toContain('selectedWarning');
    expect(command).toContain('warningActionsQ');
    expect(command).toContain('source_count');
    expect(command).toContain('healthSources');
    expect(command).toContain('observation_ingestion === false');
    expect(command).toContain('COUNTRY_CENTRES');
    expect(command).toContain('mapRef.current?.flyTo');
    expect(command).toContain('validCoordinate(event.latitude, -90, 90)');
    expect(command).toContain('import MapLibreMap, { Marker, NavigationControl }');
  });
});
