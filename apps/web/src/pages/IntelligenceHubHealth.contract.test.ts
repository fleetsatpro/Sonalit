import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const shell = read('./IntelligenceCentre.jsx');
const rail = read('../components/layout/Rail.tsx');
const alerts = read('./IntelligenceAlerts.tsx');
const newsroom = read('./IntelligenceLiveNews.jsx');
const command = read('./IntelligenceCommandView.tsx');
const deep = read('./IntelligenceCentreDeep.tsx');
const sourceControl = read('./IntelligenceSourceCommand.tsx');
const router = read('../router.tsx');
const mainEntry = read('../main.tsx');
const visualSystem = read('../styles/intelligence-centre-premium.css');
const signatureSystem = read('../styles/intelligence-centre-signature.css');
const craftSystem = read('../styles/intelligence-centre-craft.css');

describe('Intel Hub product and evidence-truth contract', () => {
  it('exposes one command, analysis, collection and dissemination shell', () => {
    for (const module of ['command', 'analysis', 'alerts', 'newsroom', 'collection', 'publications']) expect(shell).toContain("id: '" + module + "'");
    expect(shell).toContain("value === 'core') return 'analysis'");
    expect(mainEntry).toContain("import './styles/intelligence-centre-workspace.css'");
    expect(shell).toContain('function IntelligenceGlyph');
    expect(shell).not.toContain('NavArtwork');
    for (const glyph of ['command', 'analysis', 'incident', 'newsroom', 'collection', 'publications']) expect(shell).toContain("glyph: '" + glyph + "'");
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
    expect(visualSystem).toContain('.sonalit-intelligence-workspace .icd-sev');
    expect(visualSystem).toContain('font-size: 10.5px;');
    expect(shell).toContain('icw-motion-toggle');
    expect(shell).toContain('Pause decorative motion');
    expect(signatureSystem).toContain('.icw-motion-paused *');
    expect(signatureSystem).toContain('transform:translate3d');
    expect(signatureSystem).toContain('@keyframes intel-aurora-drift');
    expect(deep).toContain('function WorkbenchGlyph');
    expect(deep).toContain('aria-label="Analysis domains"');
    expect(deep).toContain('aria-label={activeGroup[1]+\' workspaces\'}');
    for (const glyph of ['situation', 'signals', 'operations', 'atlas', 'countries', 'investigations', 'forecasts', 'publications', 'watchlists', 'sources']) expect(deep).toContain("'" + glyph + "'");
    expect(deep).not.toContain('<Icon size={14}/>');
    expect(signatureSystem).toContain('grid-template-columns:repeat(5,minmax(0,1fr))');
    expect(signatureSystem).toContain('animation-iteration-count:1');
    expect(signatureSystem).toContain('prefers-reduced-motion:reduce');
    expect(command).toContain("basemap === 'dark' ? DARK_STREET_STYLE : STREET_STYLE");
    expect(command).toContain('icv-basemap-toggle');
    expect(command).toContain("basemap === 'dark' ? 'OpenFreeMap · Dark' : 'Esri World Street Map'");
    expect(craftSystem).toContain('.intelligence-live');
    expect(craftSystem).toContain('.ia-page');
    expect(craftSystem).toContain('.icd-subnav');
    expect(craftSystem).toContain('prefers-reduced-motion: reduce');
    expect(alerts).toContain('function IncidentGlyph');
    expect(alerts).not.toContain('const ICONS:');
    expect(newsroom).toContain('PREVIOUS RESULTS RETAINED');
  });

  it('uses server-side window aggregates and keeps event/warning detail separate', () => {
    expect(command).toContain('window_hours: windowHours');
    expect(command).toContain('selectedWarning');
    expect(command).toContain('warningActionsQ');
    expect(command).toContain('source_count');
    expect(command).not.toContain('assessIntelFabricHealth');
    expect(command).not.toContain('icv-health-strip');
    expect(deep).not.toContain('fabricHealth');
    expect(deep).not.toContain('icd-fabric-banner');
    expect(sourceControl).toContain('const record = run?.health || null');
    expect(sourceControl).toContain("label: 'LATEST RUN FAILED'");
    expect(command).toContain('COUNTRY_CENTRES');
    expect(command).toContain('mapRef.current?.flyTo');
    expect(command).toContain('validCoordinate(event.latitude, -90, 90)');
    expect(command).toContain('import MapLibreMap, { Marker, NavigationControl }');
  });
});
