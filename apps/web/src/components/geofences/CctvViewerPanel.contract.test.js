import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('GEV CCTV wall contract', () => {
  test('contains interactive wall, expansion, fullscreen and navigation affordances', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'CctvViewerPanel.tsx'),
      'utf8',
    )
    expect(source).toContain('CAMERA WALL')
    expect(source).toContain('gev-cctv-wall-overlay')
    expect(source).toContain('requestFullscreen')
    expect(source).toContain('ArrowRight')
    expect(source).toContain('ArrowLeft')
    expect(source).toContain('onPointerUp')
    expect(source).toContain('ZoomIn')
    expect(source).not.toContain('OPEN PUBLISHER')
    expect(source).not.toContain('PUBLISHER VIEW')
    expect(source).toContain('LIVE VIDEO · SOURCE')
    expect(source).toContain('sourceMediaUrl')
    expect(source).toContain('sourceMediaPlaybackKind')
    expect(source).toContain('LIVE VIDEO · SOURCE')
    expect(source).toContain('InlineCctvVideo')
    expect(source).toContain("import('hls.js')")
    expect(source).toContain('lowLatencyMode: true')
    expect(source).toContain('recoverMediaError')
    expect(source).toContain('stalled')
    expect(source).toContain('waiting')
    expect(source).toContain('lastProgressAt')
    expect(source).toContain('xhrSetup')
    expect(source).toContain('getAccessToken')
    expect(source).toContain('restoreAccessToken')
    expect(source).toContain('playsInline')
    expect(source).toContain('RTCPeerConnection')
    expect(source).toContain('addTransceiver')
    expect(source).toContain('recvonly')
    expect(source).toContain('setRemoteDescription')
    expect(source).toContain("'/live'")
    expect(source).toContain('whepUrlFor')
    expect(source).toContain('liveVideoCapability')
    expect(source).toContain('whepVideoCapability')
    expect(source).toContain('LIVE VIDEO / MULTI-SOURCE')
    expect(source).toContain('WHEP')
    expect((source.match(/<InlineWhepVideo/g) ?? []).length).toBe(1)
    expect(source).toContain('[cameraId, liveCapable]')
    expect(source).toContain('RECONNECTING LIVE VIDEO')
    expect(source).toContain('iceconnectionstatechange')
    expect(source).toContain('cameraDetails')
    expect(source).toContain('wallPage')
    expect(source).toContain('gev-cctv-wall-feeds--')
    expect(source).toContain('FOCUSED')
  })

  test('does not attempt to force iframe embedding for source-only cameras', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'CctvViewerPanel.tsx'),
      'utf8',
    )
    expect(source).not.toContain('<iframe')
    expect(source).toContain("mode === 'source'")
    expect(source).toContain('OPEN SOURCE')
    expect(source).toContain('gev-cctv-wall-feed-state--source')
    expect(source).not.toContain('OPEN LATEST FRAME')
    expect(source).not.toContain('href={camSourceMedia}')
  })
})
