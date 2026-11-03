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
    expect(source).toContain('providerSnapshotCapability')
    expect(source).toContain("['insecam', 'opencctv'].includes(provider)")
    expect(source).toContain('providerSnapshotEndpoint')
    expect(source).toContain('InlineCctvSnapshot')
    expect(source).toContain('wallVisualTick')
    expect(source).toContain('SNAPSHOT ONLY')
    expect(source).toContain('PROVIDER-REPORTED VIDEO')
    expect(source).toContain('sourceMediaUrl')
    expect(source).toContain('sourceMediaPlaybackKind')
    expect(source).toContain('PROVIDER-REPORTED VIDEO')
    expect(source).toContain('InlineCctvVideo')
    expect(source).toContain('PLAYBACK PROGRESSING')
    expect(source).toContain('VERIFYING PLAYBACK')
    expect(source).toContain('PLAYBACK UNAVAILABLE')
    expect(source).not.toContain('LIVE VIDEO · SOURCE')
    expect(source).not.toContain('LIVE VIDEO READY')
    expect(source).toContain("import('hls.js')")
    expect(source).toContain('isTrustedCctvApiMediaRequest')
    expect(source).toContain('xhr.withCredentials = trustedApiRequest')
    expect(source).toContain('if (!trustedApiRequest) return')
    expect(source).toContain('lowLatencyMode: false')
    expect(source).toContain('recoverMediaError')
    expect(source).toContain('playsInline')
    expect(source).toContain('RTCPeerConnection')
    expect(source).toContain('addTransceiver')
    expect(source).toContain('recvonly')
    expect(source).toContain('setRemoteDescription')
    expect(source).toContain("'/live'")
    expect(source).toContain('whepUrlFor')
    expect(source).toContain('liveVideoCapability')
    expect(source).toContain('WHEP')
    expect((source.match(/<InlineWhepVideo/g) ?? []).length).toBe(1)
    expect(source).toContain('[cameraId, liveCapable]')
    expect(source).toContain('RECONNECTING LIVE VIDEO')
    expect(source).toContain('iceconnectionstatechange')
    expect(source).toContain('cameraDetails')
    expect(source).toContain('wallPage')
    expect(source).toContain('gev-cctv-wall-feeds--')
    expect(source).toContain('FOCUSED')
    expect(source).toContain('platformVideoCapability')
    expect(source).toContain('platformEmbedUrl')
    expect(source).toContain('InlinePlatformVideo')
    expect(source).toContain('APPROVED PLATFORM EMBED')
  })

  test('only embeds explicitly sanctioned live-platform sources', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'CctvViewerPanel.tsx'),
      'utf8',
    )
    expect(source).toContain('<iframe')
    expect(source).toContain('platformEmbedUrl')
    expect(source).toContain('camPlatformVideo')
    expect(source).toContain("mode === 'source'")
  })
})
