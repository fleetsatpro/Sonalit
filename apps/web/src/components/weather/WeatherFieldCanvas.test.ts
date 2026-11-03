import { describe, expect, it } from 'vitest';
import { calculateWindSupportRadiusPx } from './WeatherFieldCanvas.js';

describe('wind-flow spatial support', () => {
  it('disables interpolated flow with fewer than two source samples', () => {
    expect(calculateWindSupportRadiusPx([])).toBe(0);
    expect(calculateWindSupportRadiusPx([{ x: 10, y: 10 }])).toBe(0);
  });

  it('uses local neighbour spacing rather than viewport dimensions', () => {
    const samples = [
      { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 40, y: 0 },
      { x: 0, y: 20 }, { x: 20, y: 20 }, { x: 40, y: 20 },
    ];
    expect(calculateWindSupportRadiusPx(samples)).toBe(24);
  });

  it('caps interpolation reach for sparse global samples', () => {
    expect(calculateWindSupportRadiusPx([{ x: 0, y: 0 }, { x: 900, y: 0 }])).toBe(176);
  });
});
