import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('Surveillance Camera Wall module contract', () => {
  test('is exposed as a first-class Surveillance child route', () => {
    const router = fs.readFileSync(path.resolve(__dirname, '../../router.tsx'), 'utf8')
    const rail = fs.readFileSync(path.resolve(__dirname, '../../components/layout/Rail.tsx'), 'utf8')
    expect(router).toContain("path:'/surveillance/camera-wall'")
    expect(router).toContain("import('./pages/SurveillanceCameraWall.js')")
    expect(rail).toContain("path:'/surveillance/camera-wall'")
    expect(rail).toContain("label:'Camera Wall'")
  })

  test('module page owns its camera catalog and standalone wall surface', () => {
    const source = fs.readFileSync(path.resolve(__dirname, './SurveillanceCameraWall.tsx'), 'utf8')
    expect(source).toContain("'/cctv/cameras'")
    expect(source).toContain("'/cctv/countries'")
    expect(source).toContain('video-capable records · playback unverified')
    expect(source).toContain('snapshot-capable sources')
    expect(source).toContain('SOURCE STATUS ≠ PLAYBACK PROOF')
    expect(source).not.toContain('VERIFIED LIVE VISUALS')
    expect(source).not.toContain('continuous video feeds')
    expect(source).toContain('countryCode')
    expect(source).toContain("params: {")
    expect(source).toContain('includeSnapshots')
    expect(source).toContain("country: countryCode")
    expect(source).toContain('selectedCountry.name')
    expect(source).toContain('standalone')
    expect(source).toContain("navigate({ to: '/surveillance' })")
    expect(source).toContain('Camera Wall')
  })

  test('GEV keeps contextual CCTV access without creating a second route', () => {
    const gev = fs.readFileSync(path.resolve(__dirname, './GodsEyeView.tsx'), 'utf8')
    expect(gev).toContain('CctvViewerPanel')
    expect(gev).toContain('gev-cctv-trigger')
    expect(gev).toContain("'/cctv/cameras'")
  })
})
