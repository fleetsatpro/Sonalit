const { classifyViewMediaType, openEyeMedia } = require('../src/services/spatial/cctv/cctvCatalog');
const { fetchApprovedMedia } = require('../src/services/spatial/cctv/cctvMediaProxy');

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