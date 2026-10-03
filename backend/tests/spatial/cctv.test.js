'use strict';

const { SAMPLE_CAMERAS, getCameraCatalog, loadOpenEyeCatalog, getCameraCatalogHealth } = require('../../src/services/spatial/cctv/cctvCatalog');
const { pointInViewshed, rankNearest } = require('../../src/services/spatial/cctv/spatialCameraGeometry');
const { assertSafeUrl, hostMatches } = require('../../src/services/spatial/cctv/cctvAllowlist');
const { getFrame, getMedia, syntheticFrame } = require('../../src/services/spatial/cctv/cctvMediaProxy');

const originalCctvEnv = process.env.CCTV_ENABLE_OPENEYE;
const originalSamplesEnv = process.env.CCTV_INCLUDE_SAMPLES;

afterEach(() => {
  if (originalCctvEnv == null) delete process.env.CCTV_ENABLE_OPENEYE;
  else process.env.CCTV_ENABLE_OPENEYE = originalCctvEnv;
  if (originalSamplesEnv == null) delete process.env.CCTV_INCLUDE_SAMPLES;
  else process.env.CCTV_INCLUDE_SAMPLES = originalSamplesEnv;
  jest.restoreAllMocks();
});

describe('spatial CCTV capability', () => {
  test('ships at least three explicitly-labelled Kenya sample cameras', () => {
    expect(SAMPLE_CAMERAS.length).toBeGreaterThanOrEqual(3);
    expect(SAMPLE_CAMERAS.every(c => c.attributes?.catalogClass === 'sample')).toBe(true);
    expect(SAMPLE_CAMERAS.every(c => c.attributes?.operational === false)).toBe(true);
  });

  test('keeps development samples opt-in and never mixes them into production catalog results', async () => {
    process.env.CCTV_ENABLE_OPENEYE = '0';
    delete process.env.CCTV_INCLUDE_SAMPLES;
    const productionRows = await getCameraCatalog();
    expect(productionRows.filter(c => c.source === 'sonalit-cctv-sample')).toHaveLength(0);

    process.env.CCTV_INCLUDE_SAMPLES = '1';
    const developmentRows = await getCameraCatalog();
    expect(developmentRows.filter(c => c.source === 'sonalit-cctv-sample')).toHaveLength(5);
    expect(developmentRows.every(c => c.source === 'sonalit-cctv-sample' ? c.media?.kind === 'synthetic' : true)).toBe(true);
  });

  test('normalizes only OpenEye previews explicitly permitted for embedding', async () => {
    process.env.CCTV_ENABLE_OPENEYE = '1';
    const payload = {
      total:2,
      free:2,
      items:[
        {
          id:'stream-kenya-1',
          handle:'nairobi-live-1',
          title:'Nairobi public camera',
          lat:-1.2864,
          lon:36.8172,
          category:'traffic',
          is_free:true,
          live:true,
          last_frame_age_s:18,
          frame_interval_s:30,
          frame_ts:1791010000000,
          view:{ render:'image', url:'https://api.openeye.cam/v1/streams/stream-kenya-1/preview.webp', url_type:'image', hosted:'openeye' },
          redistribution:{ preview_embed:true, frame_reuse:'personal-cache', attribution:{ name:'Example Traffic Authority', url:'https://example.test/cctv', required:true } }
        },
        {
          id:'stream-restricted',
          handle:'restricted',
          title:'Not embeddable',
          lat:-1.2,
          lon:36.8,
          view:{ render:'image', url:'https://example.test/restricted.jpg', url_type:'image', hosted:'source' },
          redistribution:{ preview_embed:false, attribution:{ name:'Restricted Source', url:'https://example.test' } }
        },
        {
          id:'stream-public-view',
          handle:'public-view',
          title:'Public viewer camera',
          lat:-1.21,
          lon:36.81,
          category:'traffic',
          is_free:true,
          live:true,
          view:{ render:'link', url:'https://publisher.example.test/camera/public-view', url_type:'html', hosted:'source' },
          redistribution:{ preview_embed:false, frame_reuse:'fetch-from-source', attribution:{ name:'Publisher Camera Network', url:'https://publisher.example.test', required:true } }
        }
      ]
    };
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok:true,
      json:async()=>payload
    });
    const rows = await loadOpenEyeCatalog({ center:{latitude:-1.2864,longitude:36.8172}, radiusM:25000, maxRecords:20 });
    expect(rows).toHaveLength(2);
    expect(rows[0].source).toBe('openeye-public');
    expect(rows[0].media.kind).toBe('image');
    expect(rows[0].media.direct).toBe(true);
    expect(rows[0].media.previewUrl).toContain('preview.webp');
    expect(rows[0].provenance.attribution).toBe('Example Traffic Authority');
    expect(rows[0].provenance.attributionUrl).toBe('https://example.test/cctv');
    expect(rows[0].attributes.category).toBe('traffic');
    expect(rows[1].media.direct).toBe(false);
    expect(rows[1].media.sourcePageUrl).toBe('https://publisher.example.test/camera/public-view');
    expect(rows[1].provenance.attribution).toBe('Publisher Camera Network');
    expect(getCameraCatalogHealth().openeye.status).toBe('LIVE');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://api.openeye.cam/v1/catalog?'),
      expect.objectContaining({ headers:{Accept:'application/json'} }),
    );
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

  test('SSRF guard blocks private/reserved targets, requires explicit IP allowlisting, and rejects non-HTTPS URLs', async () => {
    await expect(assertSafeUrl('http://127.0.0.1/frame.jpg', ['127.0.0.1'])).rejects.toMatchObject({ failureClass:'invalid_data' });
    await expect(assertSafeUrl('https://localhost/frame.jpg', ['localhost'])).rejects.toMatchObject({ failureClass:'invalid_data' });
    await expect(assertSafeUrl('https://100.64.0.1/frame.jpg', ['100.64.0.1'])).rejects.toMatchObject({ failureClass:'invalid_data' });
    await expect(assertSafeUrl('https://8.8.8.8/frame.jpg', ['video.example.com'])).rejects.toMatchObject({ failureClass:'invalid_data' });
    await expect(assertSafeUrl('https://8.8.8.8/frame.jpg', ['8.8.8.8'])).resolves.toBeTruthy();
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


describe('CCTV media delivery contract', () => {
  test('exposes the synthetic frame contract without external I/O', () => {
    const frame = syntheticFrame({ id:'test-camera', name:'Test camera' }, 'test');
    expect(frame.synthetic).toBe(true);
    expect(frame.contentType).toBe('image/svg+xml');
    expect(Buffer.isBuffer(frame.buffer)).toBe(true);
  });

  test('does not allow a stream without an explicit video/mjpeg media kind', async () => {
    await expect(getMedia({ id:'test-camera', name:'Test camera', media:{ kind:'image', url:'https://example.com/test.jpg' } }))
      .rejects.toMatchObject({ failureClass:'unavailable' });
  });
});
