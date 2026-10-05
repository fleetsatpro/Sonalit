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
    expect(source).toContain('OPEN PUBLISHER')
    expect(source).toContain('LIVE VIDEO · SOURCE')
    expect(source).toContain('sourceMediaUrl')
    expect(source).toContain('sourceMediaPlaybackKind')
    expect(source).toContain('LIVE VIDEO · SOURCE')
    expect(source).toContain('InlineCctvVideo')
    expect(source).toContain("import('hls.js')")
    expect(source).toContain('lowLatencyMode: true')
    expect(source).toContain('recoverMediaError')
    expect(source).toContain('playsInline')
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
