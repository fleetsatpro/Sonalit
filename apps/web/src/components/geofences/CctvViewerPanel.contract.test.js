import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  })

  test('does not attempt to force iframe embedding for source-only cameras', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'CctvViewerPanel.tsx'),
      'utf8',
    )
    expect(source).not.toContain('<iframe')
    expect(source).toContain("mode === 'source'")
    expect(source).toContain('OPEN SOURCE')
  })
})
