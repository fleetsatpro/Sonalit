import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./CorridorWorldScene.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../styles/gev-command.css', import.meta.url), 'utf8');
const globe = readFileSync(new URL('./CorridorGlobe.tsx', import.meta.url), 'utf8');
const gevPage = readFileSync(new URL('../../pages/GodsEyeView.tsx', import.meta.url), 'utf8');
describe('GEV camera navigation contract', () => {
  it('offers explicit zoom, orbit, tilt, recenter and fit controls', () => {
    for (const label of ['Zoom in','Zoom out','Orbit left','Orbit right','Tilt camera up','Tilt camera down','Pan left','Pan right','Pan up','Pan down','Recenter world','Map information']) {
      expect(source).toContain('aria-label="' + label + '"');
    }
    expect(source).toContain("aria-label={globalView ? 'Fit world' : 'Fit corridor'}");
    for (const method of ['camera.zoomIn(distance)','camera.zoomOut(distance)','camera.rotateLeft(angle)','camera.rotateRight(angle)','camera.rotateUp(angle)','camera.rotateDown(angle)','camera.moveLeft(distance)','camera.moveRight(distance)','camera.moveUp(distance)','camera.moveDown(distance)']) {
      expect(source).toContain(method);
    }
  });
  it('keeps the map clean by docking controls and hiding advanced actions until requested', () => {
    expect(source).toContain('className="gev-nav-dock pointer-events-auto"');
    expect(source).toContain('className="gev-nav-primary"');
    expect(source).toContain('className="gev-nav-advanced"');
    expect(source).toContain('aria-label={navigationExpanded ? \'Hide advanced navigation\' : \'Show advanced navigation\'}');
    expect(source).toContain('id="gev-map-navigation-help" className="sr-only"');
    expect(source).not.toContain('top-[270px]');
    expect(styles).toContain('.gev-shell .gev-map-controls--global {\n  inset: 0;');
    expect(styles).toContain('.gev-shell .gev-map-controls--global .gev-nav-dock {');
    expect(styles).toContain('right: calc(var(--gev-utility-clearance, 375px) + 24px);');
  });
    it('removes duplicate CorridorGlobe HUD from GEV and restores it for corridor surfaces', () => {
    expect(globe).toContain('{showChrome && (<>');
    expect(globe).toContain('onNavigationExpandedChange={onNavigationExpandedChange}');
    expect(gevPage).toContain('showChrome={false}');
    expect(gevPage).toContain('onNavigationExpandedChange={setMapNavigationExpanded}');
    expect(gevPage).toContain('data-navigation-expanded={mapNavigationExpanded}');
  });
  it('keeps phone and tablet controls clear of panels and reduces glass cost on mobile', () => {
    expect(source).toContain('data-expanded={navigationExpanded}');
    expect(source).toContain('onClick={toggleNavigation}');
    expect(styles).toContain('left: 254px;');
    expect(styles).toContain('bottom: calc(min(43vh, 330px) + 18px);');
    expect(styles).toContain('.gev-shell[data-navigation-expanded="true"] .gev-chrome > *');
    expect(styles).toContain('backdrop-filter: blur(10px) saturate(112%);');
    expect(source).toContain('gev-map-status-rail');
  });
  it('documents mouse and touch movement and guards destroyed viewers', () => {
    expect(source).toContain('LEFT-DRAG ORBITS');
    expect(source).toContain('RIGHT-DRAG / WHEEL ZOOMS');
    expect(source).toContain('MIDDLE-DRAG TILTS');
    expect(source).toContain('USE ARROWS TO PAN');
    expect(source).toContain('PINCH TO ZOOM');
    expect(source).toContain('if (!viewer || viewer.isDestroyed()) return;');
    expect(source).toContain('className="gev-nav-button"');
  });
});
