'use strict';

const { SAMPLE_CAMERAS, getCameraCatalog } = require('../../src/services/spatial/cctv/cctvCatalog');
const { pointInViewshed, rankNearest } = require('../../src/services/spatial/cctv/spatialCameraGeometry');
const { assertSafeUrl, hostMatches } = require('../../src/services/spatial/cctv/cctvAllowlist');
const { getFrame } = require('../../src/services/spatial/cctv/cctvMediaProxy');

describe('spatial CCTV capability', () => {
  test('ships at least three explicitly-labelled Kenya sample cameras', () => {
    expect(SAMPLE_CAMERAS.length).toBeGreaterThanOrEqual(3);
    expect(SAMPLE_CAMERAS.every(c => c.attributes?.catalogClass === 'sample')).toBe(true);
    expect(SAMPLE_CAMERAS.every(c => c.attributes?.operational === false)).toBe(true);
  });

  test('loads the deterministic sample catalog without claiming live media', async () => {
    const rows = await getCameraCatalog();
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.filter(c => c.source === 'sonalit-cctv-sample')).toHaveLength(5);
    expect(rows.some(c => c.media?.kind === 'synthetic')).toBe(true);
  });

  test('asserts geometry visibility only when target is inside heading/FOV/range', () => {
    const camera = SAMPLE_CAMERAS[0];
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
    const target = { latitude: SAMPLE_CAMERAS[0].pose.latitude, longitude: SAMPLE_CAMERAS[0].pose.longitude + 0.005 };
    const ranked = rankNearest(SAMPLE_CAMERAS, target, 3, false);
    expect(ranked).toHaveLength(3);
    expect(ranked[0].relation.distanceM).toBeLessThanOrEqual(ranked[1].relation.distanceM);
    expect(rankNearest(SAMPLE_CAMERAS, target, 10, true).every(x => x.relation.visible)).toBe(true);
  });

  test('SSRF guard blocks clear private targets and non-HTTPS URLs', async () => {
    await expect(assertSafeUrl('http://127.0.0.1/frame.jpg', ['127.0.0.1'])).rejects.toMatchObject({ failureClass:'invalid_data' });
    await expect(assertSafeUrl('https://localhost/frame.jpg', ['localhost'])).rejects.toMatchObject({ failureClass:'invalid_data' });
    await expect(assertSafeUrl('https://example.com/frame.jpg', ['not-example.com'])).rejects.toMatchObject({ failureClass:'invalid_data' });
    expect(hostMatches('cam.video.example.com', 'video.example.com')).toBe(true);
  });

  test('frame endpoint falls back to a labelled synthetic frame when no approved media exists', async () => {
    const frame = await getFrame(SAMPLE_CAMERAS[0]);
    expect(frame.synthetic).toBe(true);
    expect(frame.contentType).toBe('image/svg+xml');
    expect(frame.buffer.toString('utf8')).toContain('SONALIT CCTV');
  });
});
