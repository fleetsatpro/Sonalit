import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const weather = readFileSync(new URL('./WeatherStudio.tsx', import.meta.url), 'utf8');
const portal = readFileSync(new URL('./portal/PortalDashboardAccurate.tsx', import.meta.url), 'utf8');
const markers = readFileSync(new URL('../lib/operationalMapMarkers.ts', import.meta.url), 'utf8');
const mapStyles = readFileSync(new URL('../lib/mapStyles.ts', import.meta.url), 'utf8');

describe('map workspace provider and accessibility contracts', () => {
  it('keeps Weather Studio on Esri primary cartography with an alternate provider fallback', () => {
    expect(mapStyles).toContain('export const ESRI_STREET_STYLE');
    expect(weather).toContain('World_Street_Map');
    expect(weather).toContain("import { ESRI_STREET_STYLE, FALLBACK_STREET_STYLE }");
    expect(weather).toContain("style: ESRI_STREET_STYLE");
    expect(weather).toContain("useState<'esri' | 'fallback'>('esri')");
    expect(weather).toContain("baseStyleRef.current === 'esri'");
    expect(weather).toContain('RESILIENT BASE');
  });

  it('preserves the portal marker action name separately from its detailed tooltip', () => {
    expect(portal).toContain('ariaLabel: `Open ${shipment.reference}`');
    expect(portal).toContain("title: [shipment.reference, detail, shipment.origin, shipment.destination]");
    expect(markers).toContain('options.ariaLabel?.trim() || button.title');
  });
});
