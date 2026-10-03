import { Camera, Maximize2, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api.js'
import { enhanceImageBitmap, preferredImageryAiScale, isImageryAiEnabled } from '../../lib/imageryAi.js'
import type { SpatialWorldEntity } from '../../lib/spatialClient.js'

const FRAME_REFRESH_MS = 8_000

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function cameraName(camera: SpatialWorldEntity) {
  const attrs = record(camera.attributes)
  return String(attrs.name ?? attrs.callsign ?? attrs.title ?? camera.id)
}

function cameraMedia(camera: SpatialWorldEntity) {
  const attrs = record(camera.attributes)
  const nested = record(attrs.camera)
  return record(attrs.media ?? nested.media)
}

function cameraHealth(camera: SpatialWorldEntity) {
  const attrs = record(camera.attributes)
  const nestedHealth = record(record(attrs.camera).health)
  return String(attrs.status ?? nestedHealth.status ?? camera.status ?? 'UNKNOWN').toUpperCase()
}

function cameraSource(camera: SpatialWorldEntity) {
  return String(camera.source ?? record(camera.provenance).sourceName ?? 'CCTV')
}

export default function CctvViewerPanel({
  cameras,
  selectedCameraId,
  loading = false,
  error = false,
  onSelectCamera,
  onClose,
}: {
  cameras: SpatialWorldEntity[]
  selectedCameraId: string | null
  loading?: boolean
  error?: boolean
  onSelectCamera: (id: string) => void
  onClose: () => void
}) {
  const activeId = useMemo(
    () => (selectedCameraId && cameras.some(camera => camera.id === selectedCameraId))
      ? selectedCameraId
      : cameras[0]?.id ?? null,
    [cameras, selectedCameraId],
  )
  const activeCamera = useMemo(() => cameras.find(camera => camera.id === activeId) ?? null, [cameras, activeId])
  const [frameUrl, setFrameUrl] = useState<string | null>(null)
  const [frameState, setFrameState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [synthetic, setSynthetic] = useState(false)
  const [aiEnhanced, setAiEnhanced] = useState(false)
  const [aiRevision, setAiRevision] = useState(0)
  const aiCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const aiBitmapRef = useRef<ImageBitmap | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    if (activeId && activeId !== selectedCameraId) onSelectCamera(activeId)
  }, [activeId, onSelectCamera, selectedCameraId])

  const clearAiBitmap = useCallback(() => {
    if (aiBitmapRef.current) {
      try { aiBitmapRef.current.close() } catch { /* best effort */ }
      aiBitmapRef.current = null
    }
    setAiEnhanced(false)
    setAiRevision(v => v + 1)
  }, [])

  useEffect(() => {
    if (!activeId) {
      setFrameUrl(null)
      setFrameState('idle')
      clearAiBitmap()
      return
    }

    let disposed = false
    let objectUrl: string | null = null
    let timer: number | null = null
    let controller: AbortController | null = null

    const loadFrame = async () => {
      controller = new AbortController()
      setFrameState('loading')
      clearAiBitmap()
      try {
        const response = await api.get<Blob>(`/cctv/${encodeURIComponent(activeId)}/frame`, {
          responseType: 'blob',
          signal: controller.signal,
        })
        if (disposed) return
        const nextUrl = URL.createObjectURL(response.data)
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        objectUrl = nextUrl
        const isSyntheticFrame = String(response.headers?.['x-sonalit-cctv-synthetic'] ?? '').toLowerCase() === 'true'
        setFrameUrl(nextUrl)
        setSynthetic(isSyntheticFrame)
        setFrameState('ready')

        // Never delay the source frame for model download/GPU compilation.
        // The enhanced bitmap replaces it only after inference succeeds.
        if (!isSyntheticFrame && isImageryAiEnabled()) {
          try {
            const sourceBitmap = await createImageBitmap(response.data)
            const enhanced = await enhanceImageBitmap(sourceBitmap, preferredImageryAiScale())
            if (!disposed && enhanced) {
              aiBitmapRef.current?.close()
              aiBitmapRef.current = enhanced
              setAiEnhanced(true)
              setAiRevision(v => v + 1)
            }
            sourceBitmap.close()
          } catch {
            // Source frame remains authoritative on any AI failure.
          }
        }
      } catch {
        if (!disposed) setFrameState('error')
      } finally {
        if (!disposed) timer = window.setTimeout(() => void loadFrame(), FRAME_REFRESH_MS)
      }
    }

    void loadFrame()
    return () => {
      disposed = true
      controller?.abort()
      if (timer != null) window.clearTimeout(timer)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      clearAiBitmap()
    }
  }, [activeId, refreshTick, clearAiBitmap])

  useEffect(() => {
    const bitmap = aiBitmapRef.current
    const canvas = aiCanvasRef.current
    if (!bitmap || !canvas || !aiEnhanced) return
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) return
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0)
  }, [aiEnhanced, aiRevision])

  const health = activeCamera ? cameraHealth(activeCamera) : 'UNKNOWN'
  const media = activeCamera ? cameraMedia(activeCamera) : {}
  const mediaKind = String(media.kind ?? 'synthetic').toLowerCase()
  const hasConfiguredStream = ['video', 'mjpeg'].includes(mediaKind) && Boolean(media.url)
  const source = activeCamera ? cameraSource(activeCamera) : 'CCTV'
  const nestedCamera = record(record(activeCamera?.attributes).camera)
  const nestedAttributes = record(nestedCamera.attributes)
  const operational = nestedAttributes.operational === true || record(activeCamera?.attributes).operational === true || health === 'LIVE' || (frameState === 'ready' && !synthetic)
  const label = operational ? 'LIVE / APPROVED SOURCE' : synthetic ? 'SYNTHETIC SAMPLE' : 'CATALOG / FALLBACK'

  return (
    <aside className="gev-cctv-panel" aria-label="CCTV camera viewer">
      <div className="gev-cctv-head">
        <div className="gev-cctv-heading">
          <span className="gev-cctv-kicker"><Camera size={12} /> LIVE SURVEILLANCE</span>
          <strong>CCTV / CAMERA WALL</strong>
          <span>{cameras.length} camera{cameras.length === 1 ? '' : 's'} · approved media gateway</span>
        </div>
        <div className="gev-cctv-head-actions">
          <button type="button" className="gev-cctv-icon" onClick={() => setRefreshTick(t => t + 1)} aria-label="Refresh selected camera" title="Refresh selected camera"><RefreshCw size={13} /></button>
          <button type="button" className="gev-cctv-icon" onClick={onClose} aria-label="Close CCTV viewer" title="Close CCTV viewer"><X size={14} /></button>
        </div>
      </div>

      {activeCamera ? (
        <>
          <div className="gev-cctv-frame">
            {frameUrl ? (
              <>
                <img src={frameUrl} alt={`${cameraName(activeCamera)} latest camera frame`} decoding="async" style={{ opacity: aiEnhanced ? 0 : 1 }} />
                <canvas ref={aiCanvasRef} aria-label={`${cameraName(activeCamera)} AI UHD enhanced frame`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: aiEnhanced ? 'block' : 'none' }} />
              </>
            ) : (
              <div className="gev-cctv-frame-placeholder">
                <Camera size={22} />
                <strong>{frameState === 'loading' ? 'ACQUIRING FRAME' : 'FRAME UNAVAILABLE'}</strong>
                <span>{frameState === 'loading' ? 'The approved media gateway is retrieving the latest image.' : 'No approved image is currently available.'}</span>
              </div>
            )}
            <div className="gev-cctv-frame-hud">
              <span data-state={health}>{health}</span>
              <span>{label}</span>
              <span>{hasConfiguredStream ? mediaKind.toUpperCase() + ' SOURCE' : 'FRAME'}</span>
              {aiEnhanced && <span>AI UHD ×{preferredImageryAiScale()}</span>}
            </div>
            <div className="gev-cctv-frame-corner gev-cctv-frame-corner--tl" />
            <div className="gev-cctv-frame-corner gev-cctv-frame-corner--br" />
          </div>

          <div className="gev-cctv-camera-meta">
            <div>
              <strong>{cameraName(activeCamera)}</strong>
              <span>{source} · {Number(activeCamera.latitude).toFixed(5)}° · {Number(activeCamera.longitude).toFixed(5)}°</span>
            </div>
            <span className="gev-cctv-auto"><span /> {hasConfiguredStream ? 'STREAM CONFIGURED' : `AUTO ${FRAME_REFRESH_MS / 1000}s`}</span>
          </div>

          <div className="gev-cctv-list" role="listbox" aria-label="Available CCTV cameras">
            {cameras.slice(0, 40).map(camera => {
              const active = camera.id === activeId
              return (
                <button key={camera.id} type="button" role="option" aria-selected={active} className="gev-cctv-camera" data-active={active} onClick={() => onSelectCamera(camera.id)}>
                  <span className="gev-cctv-camera-icon"><Camera size={12} /></span>
                  <span className="gev-cctv-camera-copy">
                    <strong>{cameraName(camera)}</strong>
                    <span>{cameraSource(camera)} · {cameraHealth(camera)}</span>
                  </span>
                  {active && <Maximize2 size={11} />}
                </button>
              )
            })}
          </div>

          <div className="gev-cctv-note">
            {error
              ? 'Camera catalog sync is degraded; the last known catalog remains visible.'
              : 'Viewshed geometry describes possible visibility only. The viewer shows only media returned through the approved CCTV gateway; synthetic samples are explicitly labelled. Configured video/MJPEG sources remain gateway-controlled.'}
          </div>
        </>
      ) : (
        <div className="gev-cctv-empty">
          <Camera size={22} />
          <strong>{loading ? 'LOADING CAMERA CATALOG' : 'NO CAMERA OBSERVATIONS'}</strong>
          <span>{error ? 'The CCTV catalog could not be reached.' : 'No camera records are available from the configured provider/catalog.'}</span>
        </div>
      )}
    </aside>
  )
}
