import {
  IMAGERY_AI_ENGINE_VERSION,
  IMAGERY_AI_ORT_WEBGPU_URL,
  IMAGERY_AI_X2_MODEL_URL,
  IMAGERY_AI_X4_MODEL_URL,
  type ImageryAiScale,
} from './imageryAi.js'

type WorkerMessage = {
  type: 'enhance'
  id: number
  pixels: ArrayBuffer
  width: number
  height: number
  scale: ImageryAiScale
}

type OrtModule = {
  env: {
    wasm: { wasmPaths?: string }
  }
  InferenceSession: {
    create: (model: string, options: Record<string, unknown>) => Promise<OrtSession>
  }
  Tensor: new (type: string, data: Float32Array, dims: number[]) => OrtTensor
}

type OrtTensor = {
  data: Float32Array | Uint8Array
  dims: number[]
}

type OrtSession = {
  run: (feeds: Record<string, OrtTensor>) => Promise<Record<string, OrtTensor>>
}

declare const self: DedicatedWorkerGlobalScope

let ortPromise: Promise<OrtModule> | null = null
const sessionByScale = new Map<ImageryAiScale, Promise<OrtSession>>()

async function loadOrt() {
  if (!ortPromise) {
    ortPromise = import(/* @vite-ignore */ IMAGERY_AI_ORT_WEBGPU_URL) as Promise<OrtModule>
    ortPromise.then(ort => {
      ort.env.wasm.wasmPaths =
        'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/'
    }).catch(() => undefined)
  }
  return ortPromise
}

async function loadSession(scale: ImageryAiScale) {
  const existing = sessionByScale.get(scale)
  if (existing) return existing

  const promise = loadOrt().then(async ort => {
    const executionProviders =
      typeof navigator !== 'undefined' && 'gpu' in navigator
        ? ['webgpu', 'wasm']
        : ['wasm']

    return ort.InferenceSession.create(
      scale === 4 ? IMAGERY_AI_X4_MODEL_URL : IMAGERY_AI_X2_MODEL_URL,
      {
        executionProviders,
        graphOptimizationLevel: 'all',
        executionMode: 'parallel',
      },
    )
  })

  sessionByScale.set(scale, promise)
  return promise
}

function tensorToRgba(output: OrtTensor, width: number, height: number, scale: ImageryAiScale) {
  const outWidth = width * scale
  const outHeight = height * scale
  const values = output.data as Float32Array
  const rgba = new Uint8ClampedArray(outWidth * outHeight * 4)

  // Real-ESRGAN ONNX exports RGB NCHW float output normalized to [0,1].
  // Keep this strictly a visual enhancement; never invent semantic metadata.
  const plane = outWidth * outHeight
  for (let i = 0; i < plane; i += 1) {
    const r = Math.max(0, Math.min(1, Number(values[i] ?? 0)))
    const g = Math.max(0, Math.min(1, Number(values[plane + i] ?? 0)))
    const b = Math.max(0, Math.min(1, Number(values[(plane * 2) + i] ?? 0)))
    const dst = i * 4
    rgba[dst] = Math.round(r * 255)
    rgba[dst + 1] = Math.round(g * 255)
    rgba[dst + 2] = Math.round(b * 255)
    rgba[dst + 3] = 255
  }
  return { rgba, width: outWidth, height: outHeight }
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data
  if (!message || message.type !== 'enhance') return

  try {
    const ort = await loadOrt()
    const session = await loadSession(message.scale)

    const rgba = new Uint8ClampedArray(message.pixels)
    const plane = message.width * message.height
    const input = new Float32Array(plane * 3)

    for (let i = 0; i < plane; i += 1) {
      const src = i * 4
      input[i] = (rgba[src] ?? 0) / 255
      input[plane + i] = (rgba[src + 1] ?? 0) / 255
      input[(plane * 2) + i] = (rgba[src + 2] ?? 0) / 255
    }

    const tensor = new ort.Tensor('float32', input, [1, 3, message.height, message.width])
    const result = await session.run({ input: tensor })
    const output = result.output ?? result['output']
    if (!output) throw new Error('Real-ESRGAN output tensor missing')

    const rendered = tensorToRgba(output, message.width, message.height, message.scale)
    const canvas = new OffscreenCanvas(rendered.width, rendered.height)
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('OffscreenCanvas unavailable')
    context.putImageData(new ImageData(rendered.rgba, rendered.width, rendered.height), 0, 0)
    const bitmap = canvas.transferToImageBitmap()

    self.postMessage({
      type: 'result',
      id: message.id,
      engine: IMAGERY_AI_ENGINE_VERSION,
      bitmap,
    }, [bitmap])
  } catch (error) {
    self.postMessage({
      type: 'error',
      id: message.id,
      message: error instanceof Error ? error.message : 'Imagery AI inference failed',
    })
  }
}
