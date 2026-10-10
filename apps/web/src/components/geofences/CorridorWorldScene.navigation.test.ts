import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./CorridorWorldScene.tsx', import.meta.url), 'utf8');
describe('GEV camera navigation contract', () => {
  it('offers explicit zoom, orbit, tilt, recenter and fit controls', () => {
    for (const label of ['Zoom in','Zoom out','Orbit left','Orbit right','Tilt camera up','Tilt camera down','Recenter world','Fit world','Map information']) {
      expect(source).toContain('aria-label="' + label + '"');
    }
    for (const method of ['camera.zoomIn(distance)','camera.zoomOut(distance)','camera.rotateLeft(angle)','camera.rotateRight(angle)','camera.rotateUp(angle)','camera.rotateDown(angle)']) {
      expect(source).toContain(method);
    }
  });
  it('documents mouse and touch movement and guards destroyed viewers', () => {
    expect(source).toContain('DRAG TO ORBIT');
    expect(source).toContain('WHEEL / PINCH TO ZOOM');
    expect(source).toContain('if (!viewer || viewer.isDestroyed()) return;');
    expect(source).toContain('className="gev-nav-button"');
  });
});
