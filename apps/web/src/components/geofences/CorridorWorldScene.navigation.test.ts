import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./CorridorWorldScene.tsx', import.meta.url), 'utf8');
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
  it('documents mouse and touch movement and guards destroyed viewers', () => {
    expect(source).toContain('LEFT-DRAG TO ORBIT');
    expect(source).toContain('RIGHT-DRAG / WHEEL TO ZOOM');
    expect(source).toContain('MIDDLE-DRAG TILTS');
    expect(source).toContain('USE ARROWS TO PAN');
    expect(source).toContain('PINCH TO ZOOM');
    expect(source).toContain('if (!viewer || viewer.isDestroyed()) return;');
    expect(source).toContain('className="gev-nav-button"');
  });
});
