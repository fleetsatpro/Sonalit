'use strict';

const { normalizeRecord, getCameraCatalog } = require('../../src/services/spatial/cctv/cctvCatalog');
const { pointInViewshed, rankNearest } = require('../../src/services/spatial/cctv/spatialCameraGeometry');
const { assertSafeUrl, hostMatches } = require('../../src/services/spatial/cctv/cctvAllowlist');
const { getFrame } = require('../../src/services/spatial/cctv/cctvMediaProxy');

describe('spatial CCTV capability', () => {
  test('does not create camera entities from missing source identity', () => {
    expect(normalizeRecord({ latitude: -1.2, longitude: 36.8 }, 0)).toBeNull();
  });

  test('catalog contains only source-backed cameras', async () => {
    const rows = await getCameraCatalog();
    expect(rows.every(c => c.source !== 'sonalit-cctv-sample')).toBe(true);
    expect(rows.every(c => c.media?.kind !== 'synthetic')).toBe(true);
    expect(rows.every(c => c.attributes?.operational !== false)).toBe(true);
  });

  test('asserts geometry visibility only when target is inside heading/FOV/range', () => {
    const camera = normalizeRecord({ id:'test-camera', latitude:-1.286389, longitude:36.817223, headingDeg:110, horizontalFovDeg:80, maxRangeM:3000, pose:{confidence:'verified'} }, 0);
    const visible = pointInViewshed(camera, {
      latitude: camera.pose.latitude,
      longitude: camera.pose.longitude + 0.01
    });
    const outside = pointInViewshed(camera, {
      latitude: camera.pose.latitude,
      longitude: camera.pose.longitude - 0.01
    });
    expect(visible.visible).toBe(true);
    expect(outside.visible).toBe(false);
    expect(outside.reason).toBe('outside_horizontal_fov');
  });

  test('nearest ranking is deterministic and can enforce viewshed membership', () => {
    const target = { latitude: -1.286389, longitude: 36.817223 + 0.005 };
    const cameras = [
      normalizeRecord({ id:'c1', latitude:-1.286389, longitude:36.817223, headingDeg:110, horizontalFovDeg:80, maxRangeM:3000 }, 0),
      normalizeRecord({ id:'c2', latitude:-1.292066, longitude:36.821946, headingDeg:275, horizontalFovDeg:90, maxRangeM:3000 }, 1),
      normalizeRecord({ id:'c3', latitude:-1.301417, longitude:36.789109, headingDeg:35, horizontalFovDeg:75, maxRangeM:3500 }, 2),
    ].filter(Boolean); const ranked = rankNearest(cameras, target, 3, false);
    expect(ranked).toHaveLength(3);
    expect(ranked[0].relation.distanceM).toBeLessThanOrEqual(ranked[1].relation.distanceM);
    expect(rankNearest(cameras, target, 10, true).every(x => x.relation.visible)).toBe(true);
  });

  test('SSRF guard blocks private/reserved targets, requires explicit IP allowlisting, and rejects non-HTTPS URLs', async () => {
    await expect(assertSafeUrl('http://127.0.0.1/frame.jpg', ['127.0.0.1'])).rejects.toMatchObject({ failureClass:'invalid_data' });
    await expect(assertSafeUrl('https://localhost/frame.jpg', ['localhost'])).rejects.toMatchObject({ failureClass:'invalid_data' });
    await expect(assertSafeUrl('https://100.64.0.1/frame.jpg', ['100.64.0.1'])).rejects.toMatchObject({ failureClass:'invalid_data' });
    await expect(assertSafeUrl('https://8.8.8.8/frame.jpg', ['video.example.com'])).rejects.toMatchObject({ failureClass:'invalid_data' });
    await expect(assertSafeUrl('https://8.8.8.8/frame.jpg', ['8.8.8.8'])).resolves.toBeTruthy();
    await expect(assertSafeUrl('https://example.com/frame.jpg', ['not-example.com'])).rejects.toMatchObject({ failureClass:'invalid_data' });
    expect(hostMatches('cam.video.example.com', 'video.example.com')).toBe(true);
  });

  test('frame access fails honestly when no approved media exists', async () => {
    const camera = normalizeRecord({ id:'no-media', latitude:0, longitude:0, name:'No Media' }, 0);
    await expect(getFrame(camera)).rejects.toMatchObject({ failureClass:'media_unavailable' });
  });
});
