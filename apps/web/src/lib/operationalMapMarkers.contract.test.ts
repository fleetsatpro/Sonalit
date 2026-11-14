import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./operationalMapMarkers.ts', import.meta.url), 'utf8');

describe('shared operational map markers', () => {
  it('defines distinct silhouettes for vehicles, field officers and GPS trackers', () => {
    expect(source).toContain("vehicle: '<path");
    expect(source).toContain("guardian: '<path");
    expect(source).toContain("tracker: '<path");
    expect(source).toContain('kind: OperationalMarkerKind');
  });

  it('covers live, stale, offline and high-priority operational states', () => {
    for (const state of ['live:', 'recent:', 'stale:', 'offline:', 'sos:', 'alert:', 'unavailable:']) {
      expect(source).toContain(state);
    }
  });

  it('renders proper identity, detail, heading and accessible labels', () => {
    expect(source).toContain('.sml-device-marker__identity');
    expect(source).toContain('.sml-device-marker__detail');
    expect(source).toContain('--sml-heading');
    expect(source).toContain("button.setAttribute('aria-label', button.title)");
    expect(source).toContain("bearing.hidden = !Number.isFinite(heading)");
  });

  it('keeps the GPS anchor at the marker centre and floats labels outside the hit target', () => {
    expect(source).toContain('width:42px;height:42px');
    expect(source).toContain('position:absolute;z-index:4;left:var(--sml-marker-label-left)');
    expect(source).toContain("const markerSize = density === 'overview' ? (selected ? 9 : 7) : density === 'regional' ? (selected ? 13 : 10) : (selected ? 30 : 27)");
    expect(source).toContain('.sml-device-marker__accuracy');
    expect(source).toContain('accuracy / metresPerPixel');
    expect(source).toContain("button.dataset.accuracyVisible = 'true'");
    expect(source).toContain("button.style.setProperty('--sml-marker-label-left'");
  });

  it('adapts label density to map zoom and preserves reduced-motion preferences', () => {
    expect(source).toContain("zoom < 7.2 ? 'overview' : zoom < 11.2 ? 'regional' : 'full'");
    expect(source).toContain('@media(prefers-reduced-motion:reduce)');
    expect(source).toContain("data-selected=\"true\"");
  });
});
