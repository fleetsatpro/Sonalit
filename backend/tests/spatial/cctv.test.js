'use strict';

const { SAMPLE_CAMERAS, getCameraCatalog, loadOpenEyeCatalog, loadOpenCctvCatalog, loadCaltransCatalog, loadInsecamCatalog, getCameraCatalogHealth, getCameraById, clearOpenEyeCache } = require('../../src/services/spatial/cctv/cctvCatalog');
const { pointInViewshed, rankNearest } = require('../../src/services/spatial/cctv/spatialCameraGeometry');
const { hasInlineVideo, hasLiveVisual } = require('../../src/services/spatial/cctvGateway');
const { assertSafeUrl, hostMatches } = require('../../src/services/spatial/cctv/cctvAllowlist');
const { getFrame, getMedia, syntheticFrame } = require('../../src/services/spatial/cctv/cctvMediaProxy');

const originalCctvEnv = process.env.CCTV_ENABLE_OPENEYE;
const originalOpenCctvEnv = process.env.CCTV_ENABLE_OPENCCTV;
const originalCaltransEnv = process.env.CCTV_ENABLE_CALTRANS;
const originalInsecamEnv = process.env.CCTV_ENABLE_INSECAM;
const originalSamplesEnv = process.env.CCTV_INCLUDE_SAMPLES;

afterEach(() => {
  if (originalCctvEnv == null) delete process.env.CCTV_ENABLE_OPENEYE;
  else process.env.CCTV_ENABLE_OPENEYE = originalCctvEnv;
  if (originalOpenCctvEnv == null) delete process.env.CCTV_ENABLE_OPENCCTV;
  else process.env.CCTV_ENABLE_OPENCCTV = originalOpenCctvEnv;
  if (originalCaltransEnv == null) delete process.env.CCTV_ENABLE_CALTRANS;
  else process.env.CCTV_ENABLE_CALTRANS = originalCaltransEnv;
  if (originalInsecamEnv == null) delete process.env.CCTV_ENABLE_INSECAM;
  else process.env.CCTV_ENABLE_INSECAM = originalInsecamEnv;
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

  test('loads Insecam public snapshot cameras from its directory without probing arbitrary endpoints', async () => {
    process.env.CCTV_ENABLE_INSECAM = '1';
    const listHtml = '<a href="/en/view/123456/">Live camera in Nairobi</a><a href="/en/view/123457/">Live camera in Mombasa</a>';
    const detailHtml = (id, city, lat, lon, tags='traffic road') =>
      '<html><body><h1>Live camera in ' + city + '</h1>' +
      '<div>Camera stream</div><div>Tags: ' + tags + '</div>' +
      '<div>Country code: KE</div><div>Region: Nairobi County</div><div>City: ' + city + '</div>' +
      '<div>Latitude: ' + lat + '</div><div>Longitude: ' + lon + '</div>' +
      '<img src="http://203.0.113.20:8080/snapshot.jpg?COUNTER=1"></body></html>';
    jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes('/en/bycountry/ke/')) return { ok:true, text:async()=>listHtml };
      if (href.includes('/en/view/123456/')) return { ok:true, text:async()=>detailHtml('123456','Nairobi',-1.2864,36.8172) };
      if (href.includes('/en/view/123457/')) return { ok:true, text:async()=>detailHtml('123457','Mombasa',-4.0435,39.6682) };
      throw new Error('unexpected Insecam URL: '+href);
    });
    const rows = await loadInsecamCatalog({ countryCode:'KE', maxRecords:20 });
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.id.startsWith('insecam:'))).toBe(true);
    expect(rows.every(row => row.media.kind === 'image')).toBe(true);
    expect(rows.every(row => row.media.feedKind === 'live_snapshot')).toBe(true);
    expect(rows.every(row => row.media.provider === 'insecam')).toBe(true);
    expect(rows.every(row => row.media.providerFrameAvailable === true)).toBe(true);
    expect(rows.every(row => row.pose.confidence === 'estimated')).toBe(true);
    expect(rows[0].media.frameUrl).toBe(null);
    expect(rows[0].provenance.sourceUrl).toContain('/en/view/');
  });

  test('rejects sensitive Insecam locations before a frame is exposed', async () => {
    process.env.CCTV_ENABLE_INSECAM = '1';
    jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes('/en/bycountry/ke/')) return {
        ok:true,
        text:async()=>'<a href="/en/view/999999/">Live camera in Nairobi</a>'
      };
      if (href.includes('/en/view/999999/')) return {
        ok:true,
        text:async()=>'<div>Live camera in bedroom</div><div>Country code: KE</div><div>City: Nairobi</div><div>Latitude: -1.28</div><div>Longitude: 36.82</div><div>Tags: bedroom</div><img src="http://203.0.113.21:8080/snapshot.jpg">'
      };
      throw new Error('unexpected Insecam URL');
    });
    const rows = await loadInsecamCatalog({ countryCode:'KE', maxRecords:20 });
    expect(rows).toHaveLength(0);
  });

  test('converts a country scope into a provider bounding-box query', async () => {
    clearOpenEyeCache();
    process.env.CCTV_ENABLE_OPENEYE = '1';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok:true,
      json:async()=>({ total:0, free:0, items:[] })
    });

    const rows = await loadOpenEyeCatalog({ countryCode:'KE', maxRecords:10 });
    expect(rows).toHaveLength(0);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('bbox=33.89%2C-4.68%2C41.86%2C5.51'),
      expect.objectContaining({ headers:{Accept:'application/json'} }),
    );
  });

  test('intersects an explicit viewport with the selected country rather than escaping scope', async () => {
    clearOpenEyeCache();
    process.env.CCTV_ENABLE_OPENEYE = '1';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok:true,
      json:async()=>({ total:0, free:0, items:[] })
    });

    await loadOpenEyeCatalog({
      countryCode:'KE',
      bbox:[35.0, -2.0, 37.0, 0.0],
      maxRecords:10,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('bbox=35%2C-2%2C37%2C0'),
      expect.objectContaining({ headers:{Accept:'application/json'} }),
    );
  });

  test('does not broaden an out-of-country viewport to the full country', async () => {
    clearOpenEyeCache();
    process.env.CCTV_ENABLE_OPENEYE = '1';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok:true,
      json:async()=>({ total:0, free:0, items:[] })
    });

    const rows = await loadOpenEyeCatalog({
      countryCode:'KE',
      bbox:[-120.0, 30.0, -110.0, 40.0],
      maxRecords:10,
    });

    expect(rows).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });


  test('ingests continuous OpenCCTV feeds as playable live video and keeps country scope', async () => {
    process.env.CCTV_ENABLE_OPENCCTV = '1';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok:true,
      json:async()=>[
        {
          id:'za-video-1',
          name:'Pretoria N1 live',
          city:'Pretoria',
          country:'South Africa',
          lat:-25.7479,
          lng:28.2293,
          feed_type:'m3u8',
          feed_url:'https://cdn.example.org/pretoria/live.m3u8',
          source:'SANRAL',
          active:1
        },
        {
          id:'za-image-1',
          name:'Pretoria snapshot',
          city:'Pretoria',
          country:'South Africa',
          lat:-25.75,
          lng:28.23,
          feed_type:'image',
          feed_url:'https://cdn.example.org/pretoria/snapshot.jpg',
          source:'SANRAL',
          active:1
        },
        {
          id:'inactive-1',
          name:'Inactive',
          lat:-25.75,
          lng:28.24,
          feed_type:'m3u8',
          feed_url:'https://cdn.example.org/offline.m3u8',
          active:0
        }
      ]
    });
    const rows = await loadOpenCctvCatalog({ countryCode:'ZA', maxRecords:10 });
    expect(rows).toHaveLength(2);
    const live = rows.find(c => c.id === 'opencctv:za-video-1');
    expect(live.media.kind).toBe('video');
    expect(live.media.liveVideo).toBe(true);
    expect(live.media.feedKind).toBe('live_video');
    expect(global.fetch.mock.calls[0][0]).toContain('bounds=-34.82%2C16.34%2C-22.09%2C32.83');
  });

  test('resolves non-OpenEye live cameras for focused playback', async () => {
    process.env.CCTV_ENABLE_OPENCCTV = '1';
    process.env.CCTV_ENABLE_CALTRANS = '0';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok:true,
      json:async()=>[
        {
          id:'za-video-1',
          name:'Pretoria N1 live',
          lat:-25.7479,
          lng:28.2293,
          feed_type:'m3u8',
          feed_url:'https://cdn.example.org/pretoria/live.m3u8',
          source:'SANRAL',
          active:1
        }
      ]
    });
    const camera = await getCameraById('opencctv:za-video-1');
    expect(camera?.id).toBe('opencctv:za-video-1');
    expect(camera?.media.liveVideo).toBe(true);
    expect(camera?.media.url).toBe('https://cdn.example.org/pretoria/live.m3u8');
  });

  test('ingests official Caltrans streamingVideoURL records as live video', async () => {
    process.env.CCTV_ENABLE_CALTRANS = '1';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok:true,
      json:async()=>({
        features:[
          {
            attributes:{
              OBJECTID:1234,
              index_:55,
              imageDescription:'I-5 NB at Downtown',
              streamingVideoURL:'https://wzmedia.dot.ca.gov/D5/abc/live.m3u8',
              currentImageURL:'https://cwwp2.dot.ca.gov/data/d5/abc.jpg',
              district:5
            },
            geometry:{ x:-121.4944, y:38.5816 }
          }
        ]
      })
    });
    const rows = await loadCaltransCatalog({ countryCode:'US', maxRecords:10 });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('caltrans:1234');
    expect(rows[0].media.kind).toBe('video');
    expect(rows[0].media.liveVideo).toBe(true);
    expect(rows[0].pose.confidence).toBe('verified');
    expect(global.fetch.mock.calls[0][0]).toContain('streamingVideoURL');
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
    expect(rows[1].media.sourceMediaUrl).toBe('https://example.test/restricted.jpg');
    expect(rows[1].media.sourceMediaType).toBe('image');
    expect(rows[1].provenance.attribution).toBe('Restricted Source');
    expect(rows[2].media.direct).toBe(false);
    expect(rows[2].media.sourcePageUrl).toBe('https://publisher.example.test/camera/public-view');
    expect(rows[2].media.sourceMediaUrl).toBe(null);
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

  test('does not turn OpenEye preview_url into a direct publisher-media handoff', async () => {
    clearOpenEyeCache();
    process.env.CCTV_ENABLE_OPENEYE = '1';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok:true,
      json:async()=>({
        total:1,
        free:1,
        items:[{
          id:'preview-only',
          handle:'preview-only',
          title:'Preview-only source',
          lat:-1.28,
          lon:36.81,
          is_free:true,
          live:true,
          view:{ render:'image', url_type:'image', hosted:'source' },
          preview_url:'https://api.openeye.cam/v1/streams/preview-only/preview.webp',
          redistribution:{ preview_embed:false, frame_reuse:'fetch-from-source', attribution:{ name:'Publisher', url:'https://publisher.example.test', required:true } }
        }]
      })
    });
    const rows = await loadOpenEyeCatalog({ center:{latitude:-1.28,longitude:36.81}, radiusM:25000, maxRecords:10 });
    expect(rows).toHaveLength(1);
    expect(rows[0].media.sourceMediaUrl).toBe(null);
    expect(rows[0].media.sourcePageUrl).toBe('https://openeye.cam/cam/preview-only');
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

  test('live-only video admission requires current LIVE health, not just a video-looking URL', () => {
    const base = { id:'camera-live-test', media:{ kind:'video', url:'https://example.test/live/camera.m3u8', liveVideo:false } };
    expect(hasInlineVideo({ ...base, health:{ status:'LIVE' } })).toBe(true);
    expect(hasInlineVideo({ ...base, health:{ status:'UNKNOWN' } })).toBe(false);
    expect(hasInlineVideo({ ...base, health:{ status:'STALE' } })).toBe(false);
  });

  test('admits a recently refreshed image even when the provider live flag is uncertain', () => {
    const snapshot = {
      id:'snapshot-fresh-uncertain',
      media:{ kind:'image', url:'https://example.test/live/camera.jpg', direct:true, liveVideo:false, refreshIntervalMs:60_000 },
      health:{ status:'UNKNOWN' },
      attributes:{ lastFrameAgeS:120 }
    };
    expect(hasInlineVideo(snapshot)).toBe(false);
    expect(hasLiveVisual(snapshot)).toBe(true);
  });

  test('wall visual admission includes direct current snapshots without misclassifying them as video', () => {
    const snapshot = {
      id:'snapshot-live-test',
      media:{ kind:'image', url:'https://example.test/live/camera.jpg', frameUrl:'https://example.test/live/camera.jpg', direct:true, liveVideo:false },
      health:{ status:'LIVE' }
    };
    expect(hasInlineVideo(snapshot)).toBe(false);
    expect(hasLiveVisual(snapshot)).toBe(true);
    expect(hasLiveVisual({ ...snapshot, health:{ status:'STALE' } })).toBe(false);
    expect(hasLiveVisual({ ...snapshot, media:{ ...snapshot.media, direct:false } })).toBe(false);
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
