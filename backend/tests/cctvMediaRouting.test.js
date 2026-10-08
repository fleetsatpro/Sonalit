const { classifyViewMediaType, openEyeMedia, getCctvCountries, getCountryBbox, loadOpenCctvCamera } = require('../src/services/spatial/cctv/cctvCatalog');
const { openEyeWhepOffer, openEyeWhepDelete, fetchApprovedMedia, fetchPublicSnapshot, getMedia } = require('../src/services/spatial/cctv/cctvMediaProxy');

describe('CCTV media routing', () => {
  test('never uses a JPG/media URL as the publisher-page destination', () => {
    const media = openEyeMedia({
      id: 'stream-image',
      public_url: 'https://openeye.cam/cam/stream-image',
      view: {
        render: 'link',
        url: 'https://publisher.example/cameras/one.jpg',
        url_type: 'image'
      },
      redistribution: {
        preview_embed: false,
        frame_reuse: 'fetch-from-source',
        attribution: { name: 'Publisher', url: 'https://publisher.example/' }
      }
    });

    expect(media.sourcePageUrl).toBe('https://openeye.cam/cam/stream-image');
    expect(media.sourceMediaUrl).toBe('https://publisher.example/cameras/one.jpg');
    expect(media.sourceMediaType).toBe('image');
    expect(media.sourceMediaPlayable).toBe(false);
  });

  test('classifies direct video separately from image bytes and enables source playback', () => {
    const media = openEyeMedia({
      id: 'stream-video',
      public_url: 'https://openeye.cam/cam/stream-video',
      view: {
        render: 'video',
        url: 'https://publisher.example/live/camera.mp4',
        url_type: 'video',
        hosted: 'source'
      },
      redistribution: {
        preview_embed: false,
        frame_reuse: 'fetch-from-source',
        attribution: { name: 'Publisher', url: 'https://publisher.example/' }
      }
    });

    expect(media.sourcePageUrl).toBe('https://openeye.cam/cam/stream-video');
    expect(media.sourceMediaUrl).toBe('https://publisher.example/live/camera.mp4');
    expect(media.sourceMediaType).toBe('video');
    expect(media.sourceMediaPlayable).toBe(true);
    expect(classifyViewMediaType({ url_type:'video' }, 'https://publisher.example/live/camera.mp4', 'link')).toBe('video');
    expect(classifyViewMediaType({ url_type:'image' }, 'https://publisher.example/live/camera.jpg', 'link')).toBe('image');
    expect(classifyViewMediaType({ url_type:'video' }, 'https://publisher.example/live/camera.jpg', 'link')).toBe('image');
  });

  test('models an OpenEye live-video feed separately from a still preview', () => {
    const media = openEyeMedia({
      id: 'stream-live-video',
      public_url: 'https://openeye.cam/cam/stream-live-video',
      feed_kind: 'live_video',
      live: true,
      view: {
        render: 'image',
        url: 'https://api.openeye.cam/v1/streams/stream-live-video/preview.webp',
        url_type: 'image',
        hosted: 'openeye'
      },
      redistribution: {
        preview_embed: true,
        frame_reuse: 'personal-cache',
        attribution: { name: 'OpenEye', url: 'https://openeye.cam/' }
      }
    });

    expect(media.liveVideo).toBe(true);
    expect(media.feedKind).toBe('live_video');
    expect(media.kind).toBe('image');
    expect(media.direct).toBe(true);
  });

  test('converts a currently-live sanctioned YouTube camera into an in-app player URL', () => {
    const media = openEyeMedia({
      id: 'stream-youtube-live',
      public_url: 'https://openeye.cam/cam/stream-youtube-live',
      live: true,
      view: { render: 'link', url: 'https://www.youtube.com/watch?v=AbCdEf12345', url_type: 'html', hosted: 'youtube' },
      redistribution: { preview_embed: false, frame_reuse: 'source', attribution: { name: 'Official Camera Operator', url: 'https://example.gov/cameras/one' } }
    });
    expect(media.kind).toBe('video-platform');
    expect(media.platformEmbedUrl).toBe('https://www.youtube-nocookie.com/embed/AbCdEf12345?autoplay=1&mute=1&playsinline=1&rel=0');
    expect(media.sourcePageUrl).toBe('https://www.youtube.com/watch?v=AbCdEf12345');
  });

  test('fetches an Insecam snapshot through the bounded public-image gateway', async () => {
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url:String(url), options });
      return new Response(Buffer.from('jpeg-bytes'), {
        status:200,
        headers:{ 'content-type':'image/jpeg', 'content-length':'10' }
      });
    };
    try {
      const result = await fetchPublicSnapshot('http://93.184.216.34:8080/snapshot.jpg?COUNTER=2');
      expect(result.synthetic).toBe(false);
      expect(result.contentType).toBe('image/jpeg');
      expect(Buffer.isBuffer(result.buffer)).toBe(true);
      expect(calls[0].options.headers.Referer).toBe('https://www.insecam.org/');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('rejects private Insecam snapshot targets', async () => {
    await expect(fetchPublicSnapshot('http://127.0.0.1:8080/snapshot.jpg'))
      .rejects.toMatchObject({ failureClass:'invalid_data' });
    await expect(fetchPublicSnapshot('http://192.168.1.20:8080/snapshot.jpg'))
      .rejects.toMatchObject({ failureClass:'invalid_data' });
  });

  test('exposes global country scope metadata', () => {
    const countries = getCctvCountries();
    expect(countries.some(country => country.code === 'KE' && country.name === 'Kenya')).toBe(true);
    expect(getCountryBbox('KE')).toEqual(expect.arrayContaining([33.89, -4.68, 41.86, 5.51]));
    expect(getCountryBbox('invalid')).toBe(null);
  });

  test('relays WHEP SDP negotiation without exposing provider credentials', async () => {
    const originalFetch = global.fetch;
    const originalKey = process.env.OPENEYE_KEY;
    const calls = [];
    process.env.OPENEYE_KEY = 'test-provider-key';
    global.fetch = async (url, options) => {
      calls.push({ url, options });
      return new Response('v=0\\r\\nanswer', {
        status: 201,
        headers: { location:'https://api.openeye.cam/v1/whep/session/test', 'content-type':'application/sdp' }
      });
    };

    try {
      const result = await openEyeWhepOffer('stream-live-video', 'v=0\\r\\no=- 1 1 IN IP4 0.0.0.0');
      expect(result.ok).toBe(true);
      expect(result.status).toBe(201);
      expect(result.answer).toContain('v=0');
      expect(calls[0].url).toContain('/streams/stream-live-video/whep/offer');
      expect(calls[0].options.method).toBe('POST');
      expect(calls[0].options.headers.Authorization).toBe('Bearer test-provider-key');
      expect(calls[0].options.body).toContain('v=0');
    } finally {
      global.fetch = originalFetch;
      if (originalKey == null) delete process.env.OPENEYE_KEY;
      else process.env.OPENEYE_KEY = originalKey;
    }
  });

  test('terminates only an OpenEye WHEP session URL', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      expect(String(url)).toContain('https://api.openeye.cam/v1/streams/stream-live-video/whep/session/test');
      expect(options.method).toBe('DELETE');
      return new Response(null, { status:204 });
    };
    try {
      await expect(openEyeWhepDelete('https://api.openeye.cam/v1/streams/stream-live-video/whep/session/test')).resolves.toMatchObject({ ok:true, status:204 });
      await expect(openEyeWhepDelete('https://example.com/not-whep/test')).rejects.toMatchObject({ failureClass:'invalid_data' });
    } finally {
      global.fetch = originalFetch;
    }
  });


  test('rewrites HLS playlists and keeps downstream segment hosts bound to the advertised stream', async () => {
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url:String(url), options });
      if (String(url).includes('/live/master.m3u8')) {
        return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nsegment-1.ts\n', {
          status:200,
          headers:{'content-type':'application/vnd.apple.mpegurl'}
        });
      }
      return new Response(Buffer.from('segment'), {
        status:200,
        headers:{'content-type':'video/mp2t'}
      });
    };

    try {
      const camera = {
        id:'opencctv:123',
        media:{
          kind:'video',
          url:'https://93.184.216.34/live/master.m3u8',
        }
      };
      const playlist = await getMedia(camera);
      expect(playlist.isHlsPlaylist).toBe(true);
      expect(playlist.playlist).toContain('/api/v1/cctv/opencctv%3A123/media?target=');
      const target = decodeURIComponent(playlist.playlist.match(/target=([^\\r\\n]+)/)?.[1] || '');
      const segment = await getMedia(camera, { target });
      expect(segment.isHlsPlaylist).not.toBe(true);
      expect(String(calls[1].url)).toBe(target);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('sniffs generic-content-type HLS playlists instead of exposing them as progressive video', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => new Response('#EXTM3U\\n#EXT-X-TARGETDURATION:2\\n#EXTINF:2,\\nsegment.ts\\n', {
      status:200,
      headers:{'content-type':'application/octet-stream'}
    });
    try {
      const camera = { id:'opencctv:generic-hls', media:{ kind:'video', url:'https://93.184.216.34/live/channel' } };
      const playlist = await getMedia(camera);
      expect(playlist.isHlsPlaylist).toBe(true);
      expect(playlist.playlist).toContain('#EXTM3U');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('rejects a forged HLS proxy target outside the stream host set', async () => {
    const camera = {
      id:'caltrans:123',
      media:{
        kind:'video',
        url:'https://93.184.216.34/live/master.m3u8',
      }
    };
    await expect(
      getMedia(camera, { target:'https://198.51.100.10/private/stream.ts' })
    ).rejects.toMatchObject({ failureClass:'invalid_data' });
  });

  test('preserves HLS protocol metadata for OpenCCTV live feeds', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => new Response(JSON.stringify([{
      id:'uk-hls-1', name:'UK HLS Test', lat:51.5, lng:-0.1, countryCode:'GB',
      feed_type:'hls', feed_url:'https://media.example/live/channel', active:1, live:true
    }]), { status:200, headers:{'content-type':'application/json'} });
    try {
      const camera = await loadOpenCctvCamera('uk-hls-1');
      expect(camera.media.kind).toBe('video');
      expect(camera.media.sourceMediaType).toBe('application/vnd.apple.mpegurl');
      expect(camera.media.liveVideo).toBe(true);
      expect(camera.media.feedKind).toBe('live_video');
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('allows an authorized OpenEye-hosted video preview to use the in-app gateway', () => {
    const media = openEyeMedia({
      id: 'stream-preview-video',
      public_url: 'https://openeye.cam/cam/stream-preview-video',
      view: {
        render: 'video',
        url: 'https://media.openeye.cam/stream-preview-video.mp4',
        url_type: 'video',
        hosted: 'openeye'
      },
      redistribution: {
        preview_embed: true,
        frame_reuse: 'personal-cache',
        attribution: { name: 'OpenEye', url: 'https://openeye.cam/' }
      }
    });

    expect(media.kind).toBe('video');
    expect(media.direct).toBe(true);
    expect(media.url).toBe('https://media.openeye.cam/stream-preview-video.mp4');
  });
  test('passes byte ranges through to the upstream media server', async () => {
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = async (_url, options) => {
      calls.push(options);
      return new Response(Buffer.from('x'), {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-0/10',
          'content-length': '1',
          'accept-ranges': 'bytes',
        },
      });
    };

    try {
      const media = await fetchApprovedMedia(
        'https://93.184.216.34/live/camera.mp4',
        { allowedHosts: ['93.184.216.34'], range: 'bytes=0-0' },
      );
      expect(calls[0].headers.Range).toBe('bytes=0-0');
      expect(media.status).toBe(206);
      expect(media.contentRange).toBe('bytes 0-0/10');
      expect(media.acceptRanges).toBe('bytes');
      expect(media.contentLength).toBe('1');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
