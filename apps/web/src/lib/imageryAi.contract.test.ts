import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const core = readFileSync(new URL('./imageryAi.ts', import.meta.url), 'utf8')
const worker = readFileSync(new URL('./imageryAi.worker.ts', import.meta.url), 'utf8')
const mapLibre = readFileSync(new URL('./imageryAiMapLibre.ts', import.meta.url), 'utf8')
const cesium = readFileSync(new URL('./imageryAiCesium.ts', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./mapStyles.ts', import.meta.url), 'utf8')
const shell = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8')

describe('Sonalit imagery AI UHD contract', () => {
  it('pins the open model/runtime provenance and deep-zoom safety envelope', () => {
    expect(core).toContain("onnxruntime-web@1.30.0")
    expect(core).toContain("realesrgan-x4plus")
    expect(core).toContain("realesrgan-x2plus")
    expect(core).toContain("4851ec156207d271f5328605d0582eeb851e656227da8aca093ced9e60789291")
    expect(core).toContain("7eb5e9eb507df603c0c04b49b23c86a362e0a01575bfbbac891d970f9c331888")
    expect(core).toContain("IMAGERY_AI_MIN_ZOOM = 14")
    expect(core).toContain("IMAGERY_AI_MAX_INPUT_EDGE = 512")
    expect(core).toContain("IMAGERY_AI_CCTV_MAX_INPUT_EDGE = 640")
    expect(core).toContain("IMAGERY_AI_TILE_PADDING = 12")
    expect(core).toContain("MAX_QUEUE = 2")
    expect(core).toContain("JOB_TIMEOUT_MS = 12_000")
  })

  it('keeps GPU inference preferred and CPU fallback available', () => {
    expect(worker).toContain("['webgpu', 'wasm']")
    expect(worker).toContain("executionProviders: ['wasm']")
    expect(worker).toContain('Retry the exact same model on WASM')
    expect(worker).toContain("graphOptimizationLevel: 'all'")
    expect(worker).toContain("executionMode: 'parallel'")
    expect(worker).toContain("new ort.Tensor('float32', input, [1, 3, message.height, message.width])")
    expect(worker).toContain("result.output ?? result['output']")
    expect(worker).toContain("const bitmap = await createImageBitmap(new ImageData(cropped, cropWidth, cropHeight))")
  })

  it('routes map imagery through a custom protocol that returns source bytes on failure', () => {
    expect(mapLibre).toContain("const AI_PROTOCOL = 'sonalit-ai'")
    expect(mapLibre).toContain("maplibregl.addProtocol(AI_PROTOCOL, async (params, abortController)")
    expect(mapLibre).toContain("return { data: await blob.arrayBuffer() }")
    expect(mapLibre).toContain("const aiMinZoom = parsed.kind === 'earth' ? 7 : 14")
    expect(mapLibre).toContain("return { data: enhanced }")
    expect(cesium).toContain('wrapCesiumImageryProvider')
    expect(cesium).toContain('createAiCesiumImageryProvider')
  })

  it('makes the shared satellite style use the UHD protocol and registers it before routing', () => {
    expect(styles).toContain("sonalit-ai://satellite/{z}/{y}/{x}")
    expect(shell).toContain("installImageryAiMapLibreProtocol()")
  })
})
