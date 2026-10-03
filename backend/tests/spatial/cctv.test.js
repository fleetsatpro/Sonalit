'use strict';

const { SAMPLE_CAMERAS, getCameraCatalog, loadOpenEyeCatalog, getCameraCatalogHealth, clearOpenEyeCache } = require('../../src/services/spatial/cctv/cctvCatalog');
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
  clearOpenEyeCache();
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

  test('keeps public camera observations even when media is source-only or non-embeddable', async () => {
    clearOpenEyeCache();
    process.env.CCTV_ENABLE_OPENEYE = '1';
    const payload = {
      total:4,
      free:3,
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
          category:'traffic',
          is_free:true,
          live:true,
          view:{ render:'image', url:'https://example.test/restricted.jpg', url_type:'image', hosted:'source' },
          public_url:'https://publisher.example.test/camera/restricted',
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
        },
        {
          id:'stream-no-preview',
          handle:'no-preview',
          title:'Source-only no preview',
          lat:-1.22,
          lon:36.82,
          category:'city',
          is_free:true,
          live:false,
          view:{ render:'none', hosted:'source' },
          public_url:'https://publisher.example.test/camera/no-preview',
          redistribution:{ preview_embed:false, frame_reuse:'fetch-from-source', attribution:{ name:'Publisher Camera Network', url:'https://publisher.example.test', required:true } }
        },
        {
          id:'stream-paid',
          handle:'paid-only',
          title:'Paid camera',
          lat:-1.23,
          lon:36.83,
          category:'traffic',
          is_free:false,
          live:true,
          view:{ render:'image', url:'https://example.test/paid.jpg', url_type:'image', hosted:'source' },
          redistribution:{ preview_embed:true, attribution:{ name:'Paid Network', url:'https://example.test' } }
        }
      ]
    };
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok:true,
      json:async()=>payload
    });
    const rows = await loadOpenEyeCatalog({ center:{latitude:-1.2864,longitude:36.8172}, radiusM:25000, maxRecords:20 });
    expect(rows).toHaveLength(4);
    expect(rows.find(row => row.id === 'openeye:stream-paid')).toBeUndefined();
    expect(rows.find(row => row.id === 'openeye:stream-restricted')).toBeDefined();
    expect(rows[0].source).toBe('openeye-public');
    expect(rows[0].media.kind).toBe('image');
    expect(rows[0].media.direct).toBe(true);
    expect(rows[0].media.previewUrl).toContain('preview.webp');
    expect(rows[0].provenance.attribution).toBe('Example Traffic Authority');
    expect(rows[0].provenance.attributionUrl).toBe('https://example.test/cctv');
    expect(rows[0].attributes.category).toBe('traffic');
    expect(rows[1].media.direct).toBe(false);
    expect(rows[1].media.sourcePageUrl).toBe('https://publisher.example.test/camera/restricted');
    expect(rows[1].provenance.attribution).toBe('Restricted Source');
    expect(rows[2].media.direct).toBe(false);
    expect(rows[2].media.sourcePageUrl).toBe('https://publisher.example.test/camera/public-view');
    expect(rows[2].provenance.attribution).toBe('Publisher Camera Network');
    expect(rows[3].media.direct).toBe(false);
    expect(rows[3].media.sourcePageUrl).toBe('https://publisher.example.test/camera/no-preview');
    expect(rows[3].provenance.attribution).toBe('Publisher Camera Network');
    expect(getCameraCatalogHealth().openeye.status).toBe('LIVE');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://api.openeye.cam/v1/catalog?'),
      expect.objectContaining({ headers:{Accept:'application/json'} }),
    );
  });

  test('falls back to OpenEye map index when the enriched catalog request fails', async () => {
    clearOpenEyeCache();
    process.env.CCTV_ENABLE_OPENEYE = '1';
    let call = 0;
    jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      call += 1;
      if (call === 1) return { ok:false, status:503, json:async()=>({}) };
      return { ok:true, json:async()=>({ mode:'items', total:2, free:2, items:[
        { id:'map-ke-failure-1', handle:'nairobi-failure-1', title:'Nairobi fallback camera', lat:-1.2864, lon:36.8172, category:'traffic', is_free:true },
        { id:'map-ke-failure-2', handle:'mombasa-failure-1', title:'Mombasa fallback camera', lat:-4.0435, lon:39.6682, category:'traffic', is_free:true }
      ] }) };
    });
    const rows = await loadOpenEyeCatalog({ bbox:[36,-5,40,1], maxRecords:20 });
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.entityType === 'camera')).toBe(true);
    expect(rows.every(row => row.media.direct === false)).toBe(true);
    expect(getCameraCatalogHealth().openeye.status).toBe('DEGRADED');
    expect(getCameraCatalogHealth().openeye.recordCount).toBe(2);
    expect(getCameraCatalogHealth().openeye.error).toContain('503');
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('https://api.openeye.cam/v1/catalog/map?'), expect.objectContaining({ headers:{Accept:'application/json'} }));
  });

  test('falls back to OpenEye map index when enriched catalog has no renderable rows', async () => {
    clearOpenEyeCache();
    process.env.CCTV_ENABLE_OPENEYE = '1';
    let call = 0;
    jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      call += 1;
      if (call === 1) return { ok:true, json:async()=>({ total:12, free:12, items:[] }) };
      return { ok:true, json:async()=>({ mode:'items', total:2, free:2, items:[
        { id:'map-ke-1', handle:'nairobi-map-1', title:'Nairobi public camera', lat:-1.2864, lon:36.8172, category:'traffic', is_free:true },
        { id:'map-ke-2', handle:'mombasa-map-1', title:'Mombasa public camera', lat:-4.0435, lon:39.6682, category:'traffic', is_free:true }
      ] }) };
    });
    const rows = await loadOpenEyeCatalog({ bbox:[36,-5,40,1], maxRecords:20 });
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.entityType === 'camera')).toBe(true);
    expect(rows[0].attributes.catalogClass).toBe('public-camera-map-index');
    expect(rows[0].media.sourcePageUrl).toContain('openeye.cam/cam/map-ke-1');
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('https://api.openeye.cam/v1/catalog/map?'), expect.objectContaining({ headers:{Accept:'application/json'} }));
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
