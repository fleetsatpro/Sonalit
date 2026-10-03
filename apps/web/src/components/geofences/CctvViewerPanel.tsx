import {
  Camera, ChevronLeft, ChevronRight, ExternalLink, Expand, Maximize2, Minimize2,
  RefreshCw, RotateCcw, ZoomIn, ZoomOut, X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api.js'
import { enhanceImageBitmap, preferredImageryAiScale, isImageryAiEnabled, IMAGERY_AI_CCTV_MAX_INPUT_EDGE } from '../../lib/imageryAi.js'
import type { SpatialWorldEntity } from '../../lib/spatialClient.js'

const FRAME_REFRESH_MS = 8_000

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function cameraName(camera: SpatialWorldEntity) {
  const root = record(camera)
  const attrs = record(camera.attributes)
  return String(root.name ?? attrs.name ?? attrs.callsign ?? attrs.title ?? camera.id)
}

function cameraMedia(camera: SpatialWorldEntity) {
  const root = record(camera)
  const attrs = record(camera.attributes)
  const nested = record(attrs.camera)
  return record(root.media ?? attrs.media ?? nested.media)
}

function cameraHealth(camera: SpatialWorldEntity) {
  const root = record(camera)
  const attrs = record(camera.attributes)
  const nestedHealth = record(record(attrs.camera).health)
  const directHealth = record(root.health)
  return String(directHealth.status ?? attrs.status ?? nestedHealth.status ?? camera.status ?? 'UNKNOWN').toUpperCase()
}

function cameraSource(camera: SpatialWorldEntity) {
  return String(camera.source ?? record(camera.provenance).sourceName ?? 'CCTV')
}

function cameraMediaAttribution(camera: SpatialWorldEntity) {
  const media = cameraMedia(camera)
  const provenance = record(camera.provenance)
  return {
    name: String(media.attributionName ?? provenance.attribution ?? 'Public camera source'),
    url: String(media.attributionUrl ?? provenance.attributionUrl ?? provenance.sourceUrl ?? '').trim(),
  }
}

function cameraRefreshMs(camera: SpatialWorldEntity) {
  const media = cameraMedia(camera)
  const refresh = Number(media.refreshIntervalMs)
  return Number.isFinite(refresh) ? Math.max(15_000, refresh) : FRAME_REFRESH_MS
}

function mediaKind(camera: SpatialWorldEntity) {
  return String(cameraMedia(camera).kind ?? 'synthetic').toLowerCase()
}

function mediaDirectUrl(camera: SpatialWorldEntity) {
  const media = cameraMedia(camera)
  return String(media.previewUrl ?? media.frameUrl ?? media.url ?? '').trim()
}

function sourceViewerUrl(camera: SpatialWorldEntity) {
  const media = cameraMedia(camera)
  return String(media.sourcePageUrl ?? '').trim()
}

function frameAge(camera: SpatialWorldEntity) {
  const attrs = record(camera.attributes)
  const age = Number(attrs.lastFrameAgeS)
  if (Number.isFinite(age) && age >= 0) {
    if (age < 60) return Math.max(0, Math.round(age)) + 's ago'
    if (age < 3600) return Math.round(age / 60) + 'm ago'
    if (age < 86400) return Math.round(age / 3600) + 'h ago'
    return Math.round(age / 86400) + 'd ago'
  }
  const media = cameraMedia(camera)
  const timestamp = Number(attrs.frameTimestamp ?? media.frameTimestamp ?? 0)
  if (Number.isFinite(timestamp) && timestamp > 0) {
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
    if (seconds < 60) return seconds + 's ago'
    if (seconds < 3600) return Math.round(seconds / 60) + 'm ago'
  }
  return null
}

function sourceMode(camera: SpatialWorldEntity) {
  const media = cameraMedia(camera)
  if (media.direct === true && ['image', 'video', 'mjpeg'].includes(mediaKind(camera))) return 'direct'
  if (sourceViewerUrl(camera)) return 'source'
  if (mediaKind(camera) === 'synthetic') return 'synthetic'
  return 'gateway'
}

function streamUrlFor(camera: SpatialWorldEntity) {
  const base = String(import.meta.env['VITE_API_BASE_URL'] ?? '/api/v1').replace(/\/+$/, '')
  return base + '/cctv/' + encodeURIComponent(camera.id) + '/media'
}

export default function CctvViewerPanel({
  cameras,
  selectedCameraId,
  loading = false,
  error = false,
  onSelectCamera,
  onClose,
  publicTotal,
}: {
  cameras: SpatialWorldEntity[]
  selectedCameraId: string | null
  loading?: boolean
  error?: boolean
  publicTotal?: number | null
  onSelectCamera: (id: string) => void
  onClose: () => void
}) {
  const activeId = useMemo(
    () => (selectedCameraId && cameras.some(camera => camera.id === selectedCameraId))
      ? selectedCameraId
      : cameras[0]?.id ?? null,
    [cameras, selectedCameraId],
  )
  const activeCameraBase = useMemo(() => cameras.find(camera => camera.id === activeId) ?? null, [cameras, activeId])
  const [resolvedCamera, setResolvedCamera] = useState<SpatialWorldEntity | null>(null)

  useEffect(() => {
    if (!activeId) {
      setResolvedCamera(null)
      return
    }
    let disposed = false
    const controller = new AbortController()
    setResolvedCamera(null)
    void api.get<{ data: SpatialWorldEntity }>(`/cctv/${encodeURIComponent(activeId)}`, { signal: controller.signal })
      .then(response => {
        if (!disposed) setResolvedCamera(response.data.data)
      })
      .catch(() => {
        // The viewport catalog remains usable when detail enrichment is unavailable.
      })
    return () => {
      disposed = true
      controller.abort()
    }
  }, [activeId])

  const activeCamera = useMemo(() => {
    if (!activeCameraBase) return null
    if (!resolvedCamera || resolvedCamera.id !== activeCameraBase.id) return activeCameraBase
    return { ...activeCameraBase, ...resolvedCamera }
  }, [activeCameraBase, resolvedCamera])
  const activeIndex = useMemo(() => Math.max(0, cameras.findIndex(camera => camera.id === activeId)), [cameras, activeId])
  const [frameUrl, setFrameUrl] = useState<string | null>(null)
  const [streamUrl, setStreamUrl] = useState<string | null>(null)
  const [frameState, setFrameState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [synthetic, setSynthetic] = useState(false)
  const [aiEnhanced, setAiEnhanced] = useState(false)
  const [aiRevision, setAiRevision] = useState(0)
  const dockedAiCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const expandedAiCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const aiBitmapRef = useRef<ImageBitmap | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [browserFullscreen, setBrowserFullscreen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [previewFailures, setPreviewFailures] = useState<Set<string>>(() => new Set())
  const wallRef = useRef<HTMLElement | null>(null)
  const pointerStartX = useRef<number | null>(null)

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

  const selectRelative = useCallback((delta: number) => {
    if (!cameras.length) return
    const next = (activeIndex + delta + cameras.length) % cameras.length
    onSelectCamera(cameras[next].id)
    setZoom(1)
  }, [activeIndex, cameras, onSelectCamera])

  useEffect(() => {
    if (!activeId || !activeCamera) {
      setFrameUrl(null)
      setStreamUrl(null)
      setFrameState('idle')
      clearAiBitmap()
      return
    }

    let disposed = false
    let objectUrl: string | null = null
    let timer: number | null = null
    let controller: AbortController | null = null
    const kind = mediaKind(activeCamera)
    const direct = cameraMedia(activeCamera).direct === true
    const directUrl = mediaDirectUrl(activeCamera)
    const mode = sourceMode(activeCamera)

    const loadFrame = async () => {
      controller = new AbortController()
      setFrameState('loading')
      setStreamUrl(null)
      clearAiBitmap()
      try {
        if (direct && ['video', 'mjpeg'].includes(kind) && cameraMedia(activeCamera).url) {
          setFrameUrl(null)
          setStreamUrl(streamUrlFor(activeCamera))
          setSynthetic(false)
          setFrameState('ready')
        } else if (direct && kind === 'image' && directUrl) {
          setFrameUrl(directUrl)
          setSynthetic(false)
          setFrameState('ready')
          if (!disposed && isImageryAiEnabled()) {
            try {
              const response = await fetch(directUrl, { signal: controller.signal, credentials: 'omit' })
              if (!response.ok) throw new Error('Preview fetch failed: ' + response.status)
              const sourceBitmap = await createImageBitmap(await response.blob())
              const enhanced = await enhanceImageBitmap(sourceBitmap, preferredImageryAiScale(), IMAGERY_AI_CCTV_MAX_INPUT_EDGE)
              if (!disposed && enhanced) {
                aiBitmapRef.current?.close()
                aiBitmapRef.current = enhanced
                setAiEnhanced(true)
                setAiRevision(v => v + 1)
              }
              sourceBitmap.close()
            } catch {
              // Direct preview remains authoritative if AI/CORS/model inference fails.
            }
          }
        } else if (mode === 'source') {
          setFrameUrl(null)
          setSynthetic(false)
          setFrameState('idle')
        } else {
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
          if (!isSyntheticFrame && isImageryAiEnabled()) {
            try {
              const sourceBitmap = await createImageBitmap(response.data)
              const enhanced = await enhanceImageBitmap(sourceBitmap, preferredImageryAiScale(), IMAGERY_AI_CCTV_MAX_INPUT_EDGE)
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
        }
      } catch {
        if (!disposed) setFrameState('error')
      } finally {
        if (!disposed) timer = window.setTimeout(() => void loadFrame(), cameraRefreshMs(activeCamera))
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
  }, [activeId, activeCamera, clearAiBitmap, refreshTick])

  useEffect(() => {
    const bitmap = aiBitmapRef.current
    const canvases = [dockedAiCanvasRef.current, expandedAiCanvasRef.current].filter(Boolean) as HTMLCanvasElement[]
    if (!bitmap || !canvases.length || !aiEnhanced) return
    for (const canvas of canvases) {
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')
      if (!context) continue
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0)
    }
  }, [aiEnhanced, aiRevision])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!expanded) return
      if (event.key === 'Escape') setExpanded(false)
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        selectRelative(1)
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        selectRelative(-1)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [expanded, selectRelative])

  useEffect(() => {
    const handler = () => setBrowserFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  useEffect(() => () => { if (document.fullscreenElement) void document.exitFullscreen?.() }, [])

  const toggleBrowserFullscreen = useCallback(async () => {
    const node = wallRef.current
    if (!node) return
    try {
      if (!document.fullscreenElement) {
        await node.requestFullscreen?.()
      } else {
        await document.exitFullscreen?.()
      }
    } catch {
      setExpanded(true)
    }
  }, [])

  useEffect(() => {
    setZoom(1)
  }, [activeId])

  const health = activeCamera ? cameraHealth(activeCamera) : 'UNKNOWN'
  const media = activeCamera ? cameraMedia(activeCamera) : {}
  const kind = activeCamera ? mediaKind(activeCamera) : 'synthetic'
  const direct = activeCamera ? media.direct === true : false
  const directUrl = activeCamera ? mediaDirectUrl(activeCamera) : ''
  const viewerUrl = activeCamera ? sourceViewerUrl(activeCamera) : ''
  const attribution = activeCamera ? cameraMediaAttribution(activeCamera) : { name:'Public camera source', url:'' }
  const source = activeCamera ? cameraSource(activeCamera) : 'CCTV'
  const age = activeCamera ? frameAge(activeCamera) : null
  const mode = activeCamera ? sourceMode(activeCamera) : 'synthetic'
  const configuredStream = Boolean(activeCamera && direct && ['video','mjpeg'].includes(kind) && media.url)
  const operational = Boolean(
    activeCamera && (
      record(activeCamera.attributes).operational === true ||
      health === 'LIVE' ||
      (frameState === 'ready' && !synthetic)
    )
  )
  const label = configuredStream
    ? 'LIVE STREAM / GATEWAY'
    : direct
      ? 'PUBLIC PREVIEW'
      : mode === 'source'
        ? 'SOURCE-ONLY'
        : synthetic
          ? 'SYNTHETIC / FALLBACK'
          : operational
            ? 'LIVE / APPROVED SOURCE'
            : 'CATALOG / FALLBACK'
  const renderableCount = cameras.filter(camera => {
    const media = cameraMedia(camera)
    return media.direct === true && ['image','video','mjpeg'].includes(mediaKind(camera))
  }).length
  const sourceOnlyCount = cameras.filter(camera => sourceMode(camera) === 'source').length

  const markPreviewFailure = useCallback((id: string) => {
    setPreviewFailures(current => {
      if (current.has(id)) return current
      const next = new Set(current)
      next.add(id)
      return next
    })
  }, [])

  const sourceCard = (camera: SpatialWorldEntity, compact = false) => {
    const camMode = sourceMode(camera)
    const camViewer = sourceViewerUrl(camera)
    const camMedia = cameraMedia(camera)
    const canPreview = camMedia.direct === true && Boolean(mediaDirectUrl(camera)) && ['image'].includes(mediaKind(camera)) && !previewFailures.has(camera.id)
    if (canPreview) {
      return (
        <div className={compact ? 'gev-cctv-wall-thumb gev-cctv-wall-thumb--image' : 'gev-cctv-tile-media gev-cctv-tile-media--image'}>
          <img src={mediaDirectUrl(camera)} alt={`${cameraName(camera)} latest preview`} loading={compact ? 'lazy' : 'eager'} decoding="async" onError={() => markPreviewFailure(camera.id)} />
          <span className="gev-cctv-tile-sheen" />
        </div>
      )
    }
    return (
      <div className={compact ? 'gev-cctv-wall-thumb gev-cctv-wall-thumb--source' : 'gev-cctv-tile-media gev-cctv-tile-media--source'}>
        <Camera size={compact ? 16 : 22} />
        <strong>{camMode === 'source' ? 'PUBLISHER VIEW' : camMode === 'synthetic' ? 'NO LIVE IMAGE' : 'PREVIEW UNAVAILABLE'}</strong>
        <span>{camMode === 'source' ? 'This camera must be opened at its publisher.' : camMode === 'synthetic' ? 'The source did not authorize a renderable preview.' : 'The approved media gateway has no current frame.'}</span>
        {camViewer && (
          <a className="gev-cctv-open-source" href={camViewer} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={11} /> OPEN SOURCE
          </a>
        )}
      </div>
    )
  }

  return (
    <>
      <aside ref={node => { wallRef.current = node }} className={`gev-cctv-panel${expanded ? ' gev-cctv-panel--expanded' : ''}`} aria-label="CCTV camera viewer">
        <div className="gev-cctv-head">
          <div className="gev-cctv-heading">
            <span className="gev-cctv-kicker"><Camera size={12} /> PUBLIC CAMERA NETWORK</span>
            <strong>CAMERA WALL</strong>
            <span>{cameras.length} in viewport · {renderableCount} preview/stream · {sourceOnlyCount} publisher handoff{sourceOnlyCount === 1 ? '' : 's'}{publicTotal != null ? ` · ${publicTotal.toLocaleString()} public records` : ''}</span>
          </div>
          <div className="gev-cctv-head-actions">
            <button type="button" className="gev-cctv-icon" onClick={() => setExpanded(true)} aria-label="Expand camera wall" title="Expand camera wall"><Expand size={14} /></button>
            <button type="button" className="gev-cctv-icon" onClick={() => void toggleBrowserFullscreen()} aria-label="Enter browser fullscreen" title="Fullscreen"><Maximize2 size={13} /></button>
            <button type="button" className="gev-cctv-icon" onClick={() => setRefreshTick(t => t + 1)} aria-label="Refresh selected camera" title="Refresh selected camera"><RefreshCw size={13} /></button>
            <button type="button" className="gev-cctv-icon" onClick={onClose} aria-label="Close CCTV viewer" title="Close CCTV viewer"><X size={14} /></button>
          </div>
        </div>

        {activeCamera ? (
          <>
            <div
              className="gev-cctv-frame"
              onDoubleClick={() => setZoom(value => value > 1 ? 1 : 1.75)}
              onPointerDown={event => { pointerStartX.current = event.clientX }}
              onPointerUp={event => {
                const start = pointerStartX.current
                pointerStartX.current = null
                if (start == null) return
                const delta = event.clientX - start
                if (Math.abs(delta) >= 70) selectRelative(delta < 0 ? 1 : -1)
              }}
            >
              <div className="gev-cctv-frame-stage">
                {configuredStream && streamUrl ? (
                  kind === 'mjpeg' ? (
                    <img src={streamUrl} alt={`${cameraName(activeCamera)} live MJPEG stream`} />
                  ) : (
                    <video src={streamUrl} autoPlay muted playsInline controls preload="metadata" onError={() => setFrameState('error')} />
                  )
                ) : frameUrl ? (
                  <>
                    <img src={frameUrl} alt={`${cameraName(activeCamera)} latest camera frame`} decoding="async" style={{ opacity: aiEnhanced ? 0 : 1, transform: `scale(${zoom})` }} onError={() => setFrameState('error')} />
                    <canvas ref={dockedAiCanvasRef} aria-label={`${cameraName(activeCamera)} AI UHD enhanced frame`} style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', display:aiEnhanced ? 'block' : 'none', transform:`scale(${zoom})` }} />
                  </>
                ) : mode === 'source' ? (
                  <>
                    {sourceCard(activeCamera)}
                  </>
                ) : (
                  <div className="gev-cctv-frame-placeholder">
                    <Camera size={22} />
                    <strong>{frameState === 'loading' ? 'ACQUIRING FRAME' : frameState === 'error' ? 'FRAME LOAD FAILED' : 'FRAME UNAVAILABLE'}</strong>
                    <span>
                      {frameState === 'loading'
                        ? 'The approved media gateway is retrieving the latest image.'
                        : frameState === 'error'
                          ? 'The previous preview failed. Refresh to reacquire it.'
                          : 'No approved image is currently available.'}
                    </span>
                  </div>
                )}
              </div>
              <div className="gev-cctv-frame-hud">
                <span data-state={health}>{health}</span>
                <span>{label}</span>
                <span>{kind.toUpperCase()}</span>
                {age && <span>{age}</span>}
                {aiEnhanced && <span>AI UHD ×{preferredImageryAiScale()}</span>}
              </div>
              <div className="gev-cctv-frame-corner gev-cctv-frame-corner--tl" />
              <div className="gev-cctv-frame-corner gev-cctv-frame-corner--br" />
              <div className="gev-cctv-frame-tools" aria-label="Frame controls">
                <button type="button" onClick={() => setZoom(value => Math.min(2.5, Number((value + 0.25).toFixed(2))))} aria-label="Zoom in" title="Zoom in"><ZoomIn size={13} /></button>
                <button type="button" onClick={() => setZoom(value => Math.max(1, Number((value - 0.25).toFixed(2))))} aria-label="Zoom out" title="Zoom out"><ZoomOut size={13} /></button>
                <button type="button" onClick={() => setZoom(1)} aria-label="Reset zoom" title="Reset zoom"><RotateCcw size={12} /></button>
                <button type="button" onClick={() => setExpanded(true)} aria-label="Expand camera wall" title="Expand"><Maximize2 size={12} /></button>
              </div>
            </div>

            <div className="gev-cctv-camera-meta">
              <div>
                <strong>{cameraName(activeCamera)}</strong>
                <span>{source} · {Number(activeCamera.latitude).toFixed(5)}° · {Number(activeCamera.longitude).toFixed(5)}°{age ? ` · captured ${age}` : ''}</span>
              </div>
              <div className="gev-cctv-meta-actions">
                <button type="button" className="gev-cctv-nav" onClick={() => selectRelative(-1)} aria-label="Previous camera" title="Previous camera"><ChevronLeft size={13} /></button>
                <span className="gev-cctv-position">{activeIndex + 1}/{cameras.length}</span>
                <button type="button" className="gev-cctv-nav" onClick={() => selectRelative(1)} aria-label="Next camera" title="Next camera"><ChevronRight size={13} /></button>
              </div>
            </div>

            <div className="gev-cctv-attribution">
              SOURCE: {attribution.url
                ? <a href={attribution.url} target="_blank" rel="noreferrer noopener">{attribution.name}</a>
                : attribution.name}
              {direct && <span> · PREVIEW AUTHORIZED</span>}
              {mode === 'source' && viewerUrl && (
                <a className="gev-cctv-inline-source" href={viewerUrl} target="_blank" rel="noreferrer noopener"><ExternalLink size={10} /> OPEN PUBLISHER</a>
              )}
            </div>

            <div className="gev-cctv-list" role="listbox" aria-label="Available CCTV cameras">
              {cameras.slice(0, expanded ? 80 : 40).map(camera => {
                const active = camera.id === activeId
                const previewable = cameraMedia(camera).direct === true && mediaKind(camera) === 'image' && Boolean(mediaDirectUrl(camera)) && !previewFailures.has(camera.id)
                return (
                  <button key={camera.id} type="button" role="option" aria-selected={active} className="gev-cctv-camera" data-active={active} onClick={() => onSelectCamera(camera.id)}>
                    <span className="gev-cctv-camera-icon">
                      {previewable ? <img src={mediaDirectUrl(camera)} alt="" loading="lazy" decoding="async" onError={() => markPreviewFailure(camera.id)} /> : <Camera size={12} />}
                    </span>
                    <span className="gev-cctv-camera-copy">
                      <strong>{cameraName(camera)}</strong>
                      <span>{cameraSource(camera)} · {cameraHealth(camera)}{frameAge(camera) ? ` · ${frameAge(camera)}` : ''}</span>
                    </span>
                    {active && <Maximize2 size={11} />}
                  </button>
                )
              })}
            </div>

            <div className="gev-cctv-note">
              {error
                ? 'Camera catalog sync is degraded; the last known catalog remains visible.'
                : 'Use the wall to inspect cameras without losing the GEV. Select, swipe, zoom, expand or enter browser fullscreen. Source-only cameras keep their publisher handoff instead of pretending an embed is available.'}
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

      {expanded && activeCamera && (
        <div className="gev-cctv-wall-overlay" role="dialog" aria-modal="true" aria-label="Expanded CCTV camera wall">
          <div className="gev-cctv-wall-backdrop" onClick={() => setExpanded(false)} />
          <section className="gev-cctv-wall" ref={node => { wallRef.current = node }}>
            <header className="gev-cctv-wall-head">
              <div>
                <span className="gev-cctv-kicker"><Camera size={12} /> LIVE SPATIAL SURVEILLANCE</span>
                <strong>CAMERA WALL</strong>
                <span>{cameras.length} cameras · {renderableCount} directly renderable · {sourceOnlyCount} publisher handoffs</span>
              </div>
              <div className="gev-cctv-wall-actions">
                <button type="button" onClick={() => selectRelative(-1)} aria-label="Previous camera"><ChevronLeft size={15} /></button>
                <button type="button" onClick={() => selectRelative(1)} aria-label="Next camera"><ChevronRight size={15} /></button>
                <button type="button" onClick={() => void toggleBrowserFullscreen()} aria-label={browserFullscreen ? 'Exit browser fullscreen' : 'Browser fullscreen'}>{browserFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
                <button type="button" onClick={() => setExpanded(false)} aria-label="Close expanded camera wall"><X size={15} /></button>
              </div>
            </header>

            <div className="gev-cctv-wall-grid">
              <article className="gev-cctv-focus">
                <div className="gev-cctv-focus-media">
                  {configuredStream && streamUrl ? (
                    kind === 'mjpeg'
                      ? <img src={streamUrl} alt={`${cameraName(activeCamera)} live MJPEG stream`} onError={() => setFrameState('error')} />
                      : <video src={streamUrl} autoPlay muted playsInline controls preload="metadata" onError={() => setFrameState('error')} />
                  ) : frameUrl ? (
                    <>
                      <img src={frameUrl} alt={`${cameraName(activeCamera)} latest camera frame`} style={{ opacity:aiEnhanced ? 0 : 1, transform:`scale(${zoom})` }} onError={() => setFrameState('error')} />
                      <canvas ref={expandedAiCanvasRef} aria-label={`${cameraName(activeCamera)} AI UHD enhanced frame`} style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', display:aiEnhanced ? 'block' : 'none', transform:`scale(${zoom})` }} />
                    </>
                  ) : sourceCard(activeCamera)} 
                </div>
                <div className="gev-cctv-focus-hud">
                  <span data-state={health}>{health}</span>
                  <span>{label}</span>
                  <span>{kind.toUpperCase()}</span>
                  {age && <span>{age}</span>}
                </div>
                <div className="gev-cctv-focus-tools">
                  <button type="button" onClick={() => selectRelative(-1)} aria-label="Previous camera"><ChevronLeft size={15} /></button>
                  <button type="button" onClick={() => setZoom(Math.max(1, Number((zoom - .25).toFixed(2))))} aria-label="Zoom out"><ZoomOut size={14} /></button>
                  <button type="button" onClick={() => setZoom(1)} aria-label="Reset zoom"><RotateCcw size={13} /></button>
                  <button type="button" onClick={() => setZoom(Math.min(2.5, Number((zoom + .25).toFixed(2))))} aria-label="Zoom in"><ZoomIn size={14} /></button>
                  <button type="button" onClick={() => selectRelative(1)} aria-label="Next camera"><ChevronRight size={15} /></button>
                </div>
                <div className="gev-cctv-focus-info">
                  <div>
                    <strong>{cameraName(activeCamera)}</strong>
                    <span>{source} · {Number(activeCamera.latitude).toFixed(5)}° · {Number(activeCamera.longitude).toFixed(5)}°{age ? ` · captured ${age}` : ''}</span>
                  </div>
                  {viewerUrl && (
                    <a href={viewerUrl} target="_blank" rel="noreferrer noopener"><ExternalLink size={11} /> OPEN PUBLISHER</a>
                  )}
                </div>
              </article>

              <section className="gev-cctv-wall-cards" aria-label="Camera wall camera selection">
                {cameras.slice(0, 80).map(camera => {
                  const active = camera.id === activeId
                  const camMode = sourceMode(camera)
                  const previewable = cameraMedia(camera).direct === true && mediaKind(camera) === 'image' && Boolean(mediaDirectUrl(camera)) && !previewFailures.has(camera.id)
                  return (
                    <button
                      key={camera.id}
                      type="button"
                      className="gev-cctv-wall-card"
                      data-active={active}
                      onClick={() => onSelectCamera(camera.id)}
                      aria-pressed={active}
                    >
                      <span className="gev-cctv-wall-card-media">
                        {previewable ? (
                          <img src={mediaDirectUrl(camera)} alt="" loading="lazy" decoding="async" onError={() => markPreviewFailure(camera.id)} />
                        ) : (
                          <>
                            <Camera size={14} />
                            <small>{camMode === 'source' ? 'SOURCE' : camMode === 'synthetic' ? 'NO PREVIEW' : mediaKind(camera).toUpperCase()}</small>
                          </>
                        )}
                      </span>
                      <span className="gev-cctv-wall-card-copy">
                        <strong>{cameraName(camera)}</strong>
                        <span>{cameraSource(camera)} · {cameraHealth(camera)}</span>
                      </span>
                      {active && <span className="gev-cctv-wall-live-dot" />}
                    </button>
                  )
                })}
              </section>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
