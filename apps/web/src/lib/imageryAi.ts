export type ImageryAiScale = 2 | 4

export const IMAGERY_AI_VERSION = 'sonalit-imagery-ai-v1'
export const IMAGERY_AI_ENGINE_VERSION = 'onnxruntime-web@1.30.0'
export const IMAGERY_AI_MIN_ZOOM = 14
export const IMAGERY_AI_MAX_INPUT_EDGE = 768
export const IMAGERY_AI_X4_MODEL_SHA256 = '4851ec156207d271f5328605d0582eeb851e656227da8aca093ced9e60789291'
export const IMAGERY_AI_X2_MODEL_SHA256 = '7eb5e9eb507df603c0c04b49b23c86a362e0a01575bfbbac891d970f9c331888'

export const IMAGERY_AI_X4_MODEL_URL =
  'https://huggingface.co/skillsafe-ai/realesrgan-x4plus/resolve/107475e49b7d46412cc966481efccc3500955801/model.onnx'
export const IMAGERY_AI_X2_MODEL_URL =
  'https://huggingface.co/skillsafe-ai/realesrgan-x2plus/resolve/8166b63ed4baafea3c2867a01050c6af919527d7/model.onnx'

export const IMAGERY_AI_ORT_WEBGPU_URL =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.min.mjs'

type PendingJob = {
  id: number
  pixels: ArrayBuffer
  width: number
  height: number
  scale: ImageryAiScale
  resolve: (value: ImageBitmap | null) => void
  reject: (reason?: unknown) => void
  timer: number
}

let worker: Worker | null = null
let nextJobId = 1
let activeJob: PendingJob | null = null
const queue: PendingJob[] = []
const MAX_QUEUE = 2
const JOB_TIMEOUT_MS = 12_000

function deviceMemoryGiB() {
  return Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8)
}

function hardwareThreads() {
  return Number(navigator.hardwareConcurrency || 4)
}

export function isImageryAiEnabled() {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem('sonalit.imagery-ai') !== 'off'
}

export function setImageryAiEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem('sonalit.imagery-ai', enabled ? 'on' : 'off')
  window.dispatchEvent(new CustomEvent('sonalit-imagery-ai-change', { detail: enabled }))
}

export function imageryAiSupported() {
  return typeof Worker !== 'undefined' &&
    typeof createImageBitmap !== 'undefined' &&
    typeof navigator !== 'undefined'
}

export function preferredImageryAiScale(): ImageryAiScale {
  if (!imageryAiSupported()) return 2
  const memory = deviceMemoryGiB()
  const threads = hardwareThreads()
  const webgpu = typeof navigator.gpu !== 'undefined'
  return webgpu && memory >= 12 && threads >= 8 ? 4 : 2
}

export function preferredImageryAiScaleForZoom(level: number): ImageryAiScale {
  const preferred = preferredImageryAiScale()
  return preferred === 4 && level >= 16 ? 4 : 2
}

export function shouldEnhanceRasterZoom(level: number) {
  return Number.isFinite(level) && level >= IMAGERY_AI_MIN_ZOOM
}

function createWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./imageryAi.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = event => {
    const message = event.data as {
      type: 'result' | 'error'
      id: number
      bitmap?: ImageBitmap
      message?: string
    }
    if (!activeJob || message.id !== activeJob.id) return

    const job = activeJob
    activeJob = null
    window.clearTimeout(job.timer)

    if (message.type === 'result' && message.bitmap) {
      job.resolve(message.bitmap)
    } else {
      job.resolve(null)
    }
    pump()
  }
  worker.onerror = () => {
    failWorker(new Error('Imagery AI worker failed'))
  }
  return worker
}

function failWorker(error: Error) {
  const current = worker
  worker = null
  try { current?.terminate() } catch { /* best effort */ }

  const pending = [activeJob, ...queue].filter(Boolean) as PendingJob[]
  activeJob = null
  queue.length = 0
  for (const job of pending) {
    window.clearTimeout(job.timer)
    job.reject(error)
  }
}

function pump() {
  if (activeJob || queue.length === 0 || !isImageryAiEnabled() || !imageryAiSupported()) return

  const job = queue.shift()!
  activeJob = job
  const w = createWorker()

  job.timer = window.setTimeout(() => {
    // A stalled model load or GPU compilation must never pin a map tile.
    failWorker(new Error('Imagery AI enhancement timed out'))
  }, JOB_TIMEOUT_MS)

  try {
    w.postMessage({
      type: 'enhance',
      id: job.id,
      pixels: job.pixels,
      width: job.width,
      height: job.height,
      scale: job.scale,
    }, [job.pixels])
  } catch (error) {
    window.clearTimeout(job.timer)
    activeJob = null
    job.reject(error)
    pump()
  }
}

async function prepareBitmap(bitmap: ImageBitmap) {
  const longest = Math.max(bitmap.width, bitmap.height)
  const factor = longest > IMAGERY_AI_MAX_INPUT_EDGE ? IMAGERY_AI_MAX_INPUT_EDGE / longest : 1
  const width = Math.max(1, Math.round(bitmap.width * factor))
  const height = Math.max(1, Math.round(bitmap.height * factor))

  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : (() => {
        const c = document.createElement('canvas')
        c.width = width
        c.height = height
        return c
      })()

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Imagery AI canvas unavailable')
  ctx.drawImage(bitmap, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

export async function enhanceImageBitmap(bitmap: ImageBitmap, scale = preferredImageryAiScale()): Promise<ImageBitmap | null> {
  if (!isImageryAiEnabled() || !imageryAiSupported()) return null
  if (queue.length >= MAX_QUEUE) return null

  let prepared: ImageData
  try {
    prepared = await prepareBitmap(bitmap)
  } catch {
    return null
  }

  const id = nextJobId++
  const pixels = prepared.data.buffer.slice(0)

  return new Promise<ImageBitmap | null>((resolve, reject) => {
    queue.push({
      id,
      pixels,
      width: prepared.width,
      height: prepared.height,
      scale,
      resolve,
      reject,
      timer: 0,
    })
    pump()
  }).catch(() => null)
}

export async function enhanceImageBlob(blob: Blob, scale = preferredImageryAiScale()) {
  if (!isImageryAiEnabled() || !imageryAiSupported()) return null
  try {
    const bitmap = await createImageBitmap(blob)
    const enhanced = await enhanceImageBitmap(bitmap, scale)
    bitmap.close()
    return enhanced
  } catch {
    return null
  }
}

export function imageryAiBadge(scale = preferredImageryAiScale()) {
  return `AI UHD ×${scale} · SOURCE-PRESERVED`
}
