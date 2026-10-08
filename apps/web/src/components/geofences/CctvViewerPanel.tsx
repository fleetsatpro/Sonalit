import {
  Camera, ChevronLeft, ChevronRight, Expand, Maximize2, Minimize2,
  RefreshCw, RotateCcw, ZoomIn, ZoomOut, X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, restoreAccessToken } from '../../lib/api.js'
import { getAccessToken } from '../../stores/auth.js'
import { enhanceImageBitmap, preferredImageryAiScale, isImageryAiEnabled, IMAGERY_AI_CCTV_MAX_INPUT_EDGE } from '../../lib/imageryAi.js'
import type { SpatialWorldEntity } from '../../lib/spatialClient.js'
import type Hls from 'hls.js'

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

function providerSnapshotCapability(camera: SpatialWorldEntity) {
  const media = cameraMedia(camera)
  const provider = String(media.provider ?? '').toLowerCase()
  return ['insecam', 'opencctv'].includes(provider) &&
    media.providerFrameAvailable === true &&
    mediaKind(camera) === 'image'
}

function providerSnapshotEndpoint(camera: SpatialWorldEntity) {
  return providerSnapshotCapability(camera)
    ? '/cctv/' + encodeURIComponent(camera.id) + '/frame'
    : ''
}

function providerSnapshotUrl(camera: SpatialWorldEntity) {
  const base = String(import.meta.env['VITE_API_BASE_URL'] ?? '/api/v1').replace(/\/+$/, '')
  const endpoint = providerSnapshotEndpoint(camera)
  return endpoint ? base + endpoint : ''
}

function mediaDirectUrl(camera: SpatialWorldEntity) {
  const media = cameraMedia(camera)
  return providerSnapshotUrl(camera) || String(media.previewUrl ?? media.frameUrl ?? media.url ?? '').trim()
}

function sourceViewerUrl(camera: SpatialWorldEntity) {
  const media = cameraMedia(camera)
  return String(media.sourcePageUrl ?? '').trim()
}

function sourceMediaUrl(camera: SpatialWorldEntity) {
  const media = cameraMedia(camera)
  return String(media.sourceMediaUrl ?? '').trim()
}

function sourceMediaType(camera: SpatialWorldEntity) {
  const media = cameraMedia(camera)
  return String(media.sourceMediaType ?? '').toLowerCase().trim()
}

function sourceMediaPlaybackKind(camera: SpatialWorldEntity): 'video' | 'mjpeg' | null {
  const media = cameraMedia(camera)
  const url = sourceMediaUrl(camera)
  if (media.sourceMediaPlayable !== true || !url) return null
  const type = sourceMediaType(camera)
  if (type === 'mjpeg' || type.includes('multipart')) return 'mjpeg'
  if (
    type === 'video' ||
    type.includes('mpegurl') ||
    /\.(?:m3u8|mp4|webm|mov|m4v|og[gv]|mjpg|mjpeg)(?:[?#].*)?$/i.test(url)
  ) return 'video'
  return null
}

function sourceMediaIsImage(camera: SpatialWorldEntity) {
  const url = sourceMediaUrl(camera)
  const type = sourceMediaType(camera)
  return type === 'image' || /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url)
}

function liveVideoCapability(camera: SpatialWorldEntity) {
  return cameraMedia(camera).liveVideo === true
}

function whepVideoCapability(camera: SpatialWorldEntity) {
  return cameraMedia(camera).liveVideo === true && String(camera.id).startsWith('openeye:')
}

function platformEmbedUrl(camera: SpatialWorldEntity) {
  return String(cameraMedia(camera).platformEmbedUrl ?? '').trim()
}

function platformVideoCapability(camera: SpatialWorldEntity) {
  return cameraHealth(camera) === 'LIVE' && Boolean(platformEmbedUrl(camera))
}

function InlinePlatformVideo({ src, title }: { src: string; title: string }) {
  return (
    <iframe
      src={src}
      title={title}
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      className="gev-cctv-platform-player"
    />
  )
}

function whepUrlFor(camera: SpatialWorldEntity) {
  const base = String(import.meta.env['VITE_API_BASE_URL'] ?? '/api/v1').replace(/\/+$/, '')
  return base + '/cctv/' + encodeURIComponent(camera.id) + '/live'
}

async function waitForIceGatheringComplete(peer: RTCPeerConnection, timeoutMs = 2500) {
  if (peer.iceGatheringState === 'complete') return
  await new Promise<void>(resolve => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      peer.removeEventListener('icegatheringstatechange', onStateChange)
      resolve()
    }
    const onStateChange = () => {
      if (peer.iceGatheringState === 'complete') finish()
    }
    const timer = window.setTimeout(finish, timeoutMs)
    peer.addEventListener('icegatheringstatechange', onStateChange)
  })
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
  if (providerSnapshotCapability(camera)) return 'gateway'
  if (sourceViewerUrl(camera)) return 'source'
  if (mediaKind(camera) === 'synthetic') return 'synthetic'
  return 'gateway'
}

function streamUrlFor(camera: SpatialWorldEntity) {
  const base = String(import.meta.env['VITE_API_BASE_URL'] ?? '/api/v1').replace(/\/+$/, '')
  return base + '/cctv/' + encodeURIComponent(camera.id) + '/media'
}

function isHlsUrl(url: string, mediaType: string) {
  return mediaType.includes('mpegurl') || /\.(?:m3u8)(?:[?#].*)?$/i.test(url)
}

function cameraPlaybackMediaType(camera: SpatialWorldEntity) {
  const media = cameraMedia(camera)
  const upstreamType = String(media.sourceMediaType ?? '').toLowerCase()
  const upstreamUrl = String(media.url ?? '')
  return isHlsUrl(upstreamUrl, upstreamType) ? 'application/vnd.apple.mpegurl' : mediaKind(camera)
}

function InlineCctvSnapshot({
  endpoint,
  alt,
  refreshKey = 0,
}: {
  endpoint: string
  alt: string
  refreshKey?: number
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let disposed = false
    let nextUrl: string | null = null
    const load = async () => {
      try {
        const response = await api.get<Blob>(endpoint, {
          responseType: 'blob',
        })
        if (disposed) return
        const synthetic = String(response.headers?.['x-sonalit-cctv-synthetic'] ?? '').toLowerCase() === 'true'
        if (synthetic) throw new Error('Synthetic frame returned')
        nextUrl = URL.createObjectURL(response.data)
        setFailed(false)
        setObjectUrl(current => {
          if (current) URL.revokeObjectURL(current)
          return nextUrl
        })
      } catch {
        if (disposed) return
        // Preserve the last good frame during a transient provider failure.
        // A wall tile should degrade gracefully rather than flash empty.
        setFailed(true)
      }
    }
    void load()
    return () => {
      disposed = true
      if (nextUrl) URL.revokeObjectURL(nextUrl)
    }
  }, [endpoint, refreshKey])

  if (!objectUrl) {
    return (
      <div className="gev-cctv-wall-feed-state">
        <Camera size={18} />
        <strong>{failed ? 'LIVE SNAPSHOT UNAVAILABLE' : 'ACQUIRING LIVE FRAME'}</strong>
        <span>{failed ? 'The current public camera image could not be reacquired; retrying.' : 'Fetching the current public camera frame.'}</span>
      </div>
    )
  }

  return (
    <div className="gev-cctv-wall-feed-media-source">
      <img
        src={objectUrl}
        alt={alt}
        loading="lazy"
        decoding="async"
      />
      {failed && <span className="gev-cctv-wall-feed-source-badge"><i /> LAST FRAME · RETRYING</span>}
    </div>
  )
}

function InlineCctvVideo({
  src,
  mediaType = 'video',
  poster,
  onError,
}: {
  src: string
  mediaType?: string
  poster?: string
  onError?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    let disposed = false
    let hls: Hls | null = null
    let fatalRecovery = 0
    let authRefreshAttempted = false
    let playbackRecovery = 0
    let stallTimer: number | null = null
    let lastProgressAt = Date.now()
    const hlsSource = isHlsUrl(src, mediaType)

    const fail = () => {
      if (!disposed) onErrorRef.current?.()
    }

    const clearStallTimer = () => {
      if (stallTimer != null) {
        window.clearTimeout(stallTimer)
        stallTimer = null
      }
    }

    const recoverStalledPlayback = () => {
      if (disposed || video.paused || video.ended) return
      if (playbackRecovery >= 3) {
        fail()
        return
      }
      playbackRecovery += 1
      lastProgressAt = Date.now()
      clearStallTimer()
      if (hls) {
        try {
          hls.startLoad(-1)
        } catch {
          // Full reattach below is the fallback.
        }
        void video.play().catch(() => {})
        return
      }
      const currentTime = video.currentTime
      video.load()
      if (Number.isFinite(currentTime) && currentTime > 0) {
        try { video.currentTime = currentTime } catch { /* best effort */ }
      }
      void video.play().catch(() => {})
    }

    const scheduleStallRecovery = () => {
      clearStallTimer()
      stallTimer = window.setTimeout(() => {
        stallTimer = null
        const noProgressFor = Date.now() - lastProgressAt
        if (noProgressFor >= 6000 && (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA || video.readyState < 3)) {
          recoverStalledPlayback()
        }
      }, 6500)
    }

    const onProgress = () => {
      lastProgressAt = Date.now()
      playbackRecovery = 0
      clearStallTimer()
    }

    const onWaiting = () => scheduleStallRecovery()
    const onStalled = () => scheduleStallRecovery()
    const onEnded = () => recoverStalledPlayback()

    const attach = async () => {
      if (hlsSource) {
        try {
          const { default: HlsRuntime } = await import('hls.js')
          if (disposed) return

          if (HlsRuntime.isSupported()) {
            hls = new HlsRuntime({
              enableWorker: true,
              lowLatencyMode: true,
              backBufferLength: 30,
              maxLiveSyncPlaybackRate: 1.5,
              capLevelToPlayerSize: true,
              startLevel: -1,
              xhrSetup: (xhr: XMLHttpRequest) => {
                const token = getAccessToken()
                if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
                xhr.withCredentials = true
              },
            })
            hls.on(HlsRuntime.Events.ERROR, async (_event, data) => {
              if (!data?.fatal) return
              const responseCode = Number(data?.response?.code)
              if (responseCode === 401 && !authRefreshAttempted) {
                authRefreshAttempted = true
                try {
                  await restoreAccessToken()
                  fatalRecovery += 1
                  hls?.startLoad(-1)
                  return
                } catch {
                  // Fall through to the normal bounded recovery path.
                }
              }
              if (data.type === HlsRuntime.ErrorTypes.NETWORK_ERROR && fatalRecovery < 1) {
                fatalRecovery += 1
                hls?.startLoad()
                return
              }
              if (data.type === HlsRuntime.ErrorTypes.MEDIA_ERROR && fatalRecovery < 2) {
                fatalRecovery += 1
                hls?.recoverMediaError()
                return
              }
              hls?.destroy()
              hls = null
              fail()
            })
            hls.attachMedia(video)
            hls.loadSource(src)
            return
          }
        } catch {
          // Native HLS fallback below.
        }

        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = src
          return
        }

        fail()
        return
      }

      video.src = src
    }

    video.addEventListener('error', fail)
    video.addEventListener('playing', onProgress)
    video.addEventListener('timeupdate', onProgress)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('stalled', onStalled)
    video.addEventListener('ended', onEnded)
    void attach()

    return () => {
      disposed = true
      video.removeEventListener('error', fail)
      video.removeEventListener('playing', onProgress)
      video.removeEventListener('timeupdate', onProgress)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('stalled', onStalled)
      video.removeEventListener('ended', onEnded)
      clearStallTimer()
      if (hls) {
        hls.destroy()
        hls = null
      }
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [mediaType, src])

  return (
    <video
      ref={videoRef}
      poster={poster}
      autoPlay
      muted
      playsInline
      controls
      preload="metadata"
    />
  )
}

function InlineWhepVideo({
  camera,
  onError,
}: {
  camera: SpatialWorldEntity
  onError?: (message: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const cameraId = String(camera.id)
  const liveCapable = liveVideoCapability(camera)
  const poster = typeof cameraMedia(camera).previewUrl === 'string' ? cameraMedia(camera).previewUrl : undefined
  const liveUrl = whepUrlFor({ id: cameraId } as SpatialWorldEntity)
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting')
  const [statusMessage, setStatusMessage] = useState('NEGOTIATING LIVE VIDEO')

  useEffect(() => {
    const video = videoRef.current
    if (!video || !liveCapable) return
    let disposed = false
    let peer: RTCPeerConnection | null = null
    let sessionLocation: string | null = null
    let retryTimer: number | null = null
    let retryAttempt = 0
    let connectGeneration = 0

    const clearRetryTimer = () => {
      if (retryTimer != null) {
        window.clearTimeout(retryTimer)
        retryTimer = null
      }
    }

    const closePeer = (deleteSession = true) => {
      const previousPeer = peer
      const previousSession = sessionLocation
      peer = null
      sessionLocation = null
      previousPeer?.getTransceivers().forEach(transceiver => {
        try { transceiver.stop() } catch { /* best effort */ }
      })
      previousPeer?.close()
      streamRef.current?.getTracks().forEach(track => track.stop())
      streamRef.current = null
      video.pause()
      video.srcObject = null
      if (deleteSession && previousSession) {
        void api.delete(liveUrl, { data: { location: previousSession } }).catch(() => {})
      }
    }

    const terminalFail = (message: string) => {
      if (disposed) return
      clearRetryTimer()
      setStatus('error')
      setStatusMessage(message)
      onErrorRef.current?.(message)
    }

    const scheduleReconnect = (message = 'RECONNECTING LIVE VIDEO') => {
      if (disposed || retryTimer != null) return
      connectGeneration += 1
      setStatus('connecting')
      setStatusMessage(message)
      const delay = Math.min(8_000, 750 * (2 ** Math.min(retryAttempt, 3)))
      retryAttempt += 1
      const generation = connectGeneration
      retryTimer = window.setTimeout(() => {
        retryTimer = null
        if (disposed || generation !== connectGeneration) return
        closePeer()
        void connect()
      }, delay)
    }

    const connect = async () => {
      if (disposed) return
      clearRetryTimer()
      const generation = ++connectGeneration
      closePeer()
      setStatus('connecting')
      setStatusMessage(retryAttempt ? 'RECONNECTING LIVE VIDEO' : 'NEGOTIATING LIVE VIDEO')

      const nextPeer = new RTCPeerConnection({
        bundlePolicy: 'max-bundle',
        iceServers: [
          { urls: 'stun:stun.cloudflare.com:3478' },
          { urls: 'stun:stun.l.google.com:19302' },
        ],
      })
      peer = nextPeer
      const localStream = new MediaStream()
      streamRef.current = localStream

      const failTransient = (message: string) => {
        if (!disposed && generation === connectGeneration) scheduleReconnect(message)
      }

      nextPeer.addTransceiver('video', { direction: 'recvonly' })
      nextPeer.addEventListener('connectionstatechange', () => {
        if (disposed || generation !== connectGeneration) return
        if (nextPeer.connectionState === 'failed' || nextPeer.connectionState === 'disconnected') {
          failTransient('LIVE VIDEO CONNECTION LOST · RECONNECTING')
        }
      })
      nextPeer.addEventListener('iceconnectionstatechange', () => {
        if (disposed || generation !== connectGeneration) return
        if (nextPeer.iceConnectionState === 'failed' || nextPeer.iceConnectionState === 'disconnected') {
          failTransient('LIVE VIDEO NETWORK LOST · RECONNECTING')
        }
      })
      nextPeer.addEventListener('track', event => {
        if (disposed || generation !== connectGeneration) return
        const incoming = event.streams?.[0]
        if (incoming) {
          video.srcObject = incoming
        } else {
          localStream.addTrack(event.track)
          video.srcObject = localStream
        }
        event.track.addEventListener('ended', () => {
          if (!disposed && generation === connectGeneration) {
            scheduleReconnect('LIVE VIDEO TRACK ENDED · RECONNECTING')
          }
        }, { once: true })
        retryAttempt = 0
        setStatus('live')
        setStatusMessage('LIVE')
        void video.play().catch(() => {})
      })

      try {
        const offer = await nextPeer.createOffer()
        await nextPeer.setLocalDescription(offer)
        await waitForIceGatheringComplete(nextPeer)

        const sdp = nextPeer.localDescription?.sdp || offer.sdp
        if (!sdp) throw new Error('Local SDP offer was empty')

        const response = await api.post(liveUrl, { sdp }, {
          headers: {
            Accept: 'application/sdp',
            'Content-Type': 'application/json',
          },
          responseType: 'text',
          timeout: 15_000,
        })

        const answer = typeof response.data === 'string'
          ? response.data
          : String((response.data as { sdp?: string } | null)?.sdp || '')
        if (!answer.trim()) throw new Error('Live-video SDP answer was empty')

        const returnedSessionLocation = typeof response.headers?.['x-sonalit-whep-session'] === 'string'
          ? response.headers['x-sonalit-whep-session']
          : typeof response.headers?.location === 'string'
            ? response.headers.location
            : typeof response.headers?.['x-whep-session'] === 'string'
              ? response.headers['x-whep-session']
              : null
        sessionLocation = returnedSessionLocation

        if (disposed || generation !== connectGeneration) {
          if (returnedSessionLocation) {
            void api.delete(liveUrl, { data: { location: returnedSessionLocation } }).catch(() => {})
          }
          return
        }

        await nextPeer.setRemoteDescription({ type: 'answer', sdp: answer })
      } catch (error) {
        if (disposed || generation !== connectGeneration) return
        const httpStatus = (error as { response?: { status?: number } } | null)?.response?.status
        if (httpStatus === 402) terminalFail('LIVE VIDEO PAYMENT REQUIRED')
        else if (httpStatus === 401 || httpStatus === 403) terminalFail('LIVE VIDEO AUTHORIZATION REQUIRED')
        else if (httpStatus === 409) terminalFail('CAMERA IS NOT A LIVE VIDEO FEED')
        else scheduleReconnect('LIVE VIDEO UNAVAILABLE · RETRYING')
      }
    }

    void connect()

    return () => {
      disposed = true
      clearRetryTimer()
      connectGeneration += 1
      closePeer()
    }
  }, [cameraId, liveCapable])

  return (
    <div className="gev-cctv-whep-player" data-status={status}>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        controls
        preload="none"
        poster={poster}
        aria-label={cameraName(camera) + ' live video'}
      />
      {status !== 'live' && (
        <div className="gev-cctv-whep-state">
          <span className={status === 'error' ? 'gev-cctv-whep-state-icon gev-cctv-whep-state-icon--error' : 'gev-cctv-whep-state-icon'}><i /></span>
          <strong>{status === 'connecting' ? 'CONNECTING LIVE VIDEO' : 'LIVE VIDEO UNAVAILABLE'}</strong>
          <span>{statusMessage}</span>
        </div>
      )}
      {status === 'live' && <div className="gev-cctv-whep-live-badge"><i /> LIVE · WHEP</div>}
    </div>
  )
}

export default function CctvViewerPanel({
  cameras,
  selectedCameraId,
  loading = false,
  error = false,
  onSelectCamera,
  onClose,
  publicTotal,
  standalone = false,
}: {
  cameras: SpatialWorldEntity[]
  selectedCameraId: string | null
  loading?: boolean
  error?: boolean
  publicTotal?: number | null
  standalone?: boolean
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
        if (!disposed) {
          const detail = response.data.data
          cameraDetailsRef.current[activeId] = detail
          setCameraDetails(current => ({ ...current, [activeId]: detail }))
          setResolvedCamera(detail)
        }
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
  const [expanded, setExpanded] = useState(standalone)
  const [browserFullscreen, setBrowserFullscreen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [previewFailures, setPreviewFailures] = useState<Set<string>>(() => new Set())
  const [streamFailures, setStreamFailures] = useState<Set<string>>(() => new Set())
  const [cameraDetails, setCameraDetails] = useState<Record<string, SpatialWorldEntity>>({})
  const [wallLayout, setWallLayout] = useState<2 | 3 | 4>(3)
  const [wallPage, setWallPage] = useState(0)
  const [wallVisualTick, setWallVisualTick] = useState(0)
  const cameraDetailsRef = useRef<Record<string, SpatialWorldEntity>>({})
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

  useEffect(() => {
    if (standalone) setExpanded(true)
  }, [standalone])

  const wallPageSize = wallLayout * wallLayout
  const wallPageCount = Math.max(1, Math.ceil(cameras.length / wallPageSize))
  const wallCameras = useMemo(
    () => cameras.slice(wallPage * wallPageSize, (wallPage + 1) * wallPageSize),
    [cameras, wallPage, wallPageSize],
  )

  useEffect(() => {
    if (!expanded || !cameras.length) return
    let cancelled = false
    const targets = wallCameras.filter(camera => !cameraDetailsRef.current[camera.id])
    let cursor = 0
    const worker = async () => {
      while (!cancelled) {
        const index = cursor++
        if (index >= targets.length) return
        const camera = targets[index]
        try {
          const response = await api.get<{ data: SpatialWorldEntity }>(`/cctv/${encodeURIComponent(camera.id)}`)
          if (cancelled) return
          const detail = response.data.data
          cameraDetailsRef.current[camera.id] = detail
          setCameraDetails(current => ({ ...current, [camera.id]: detail }))
        } catch {
          // The wall keeps the catalog card when detail enrichment is unavailable.
        }
      }
    }
    void Promise.all([worker(), worker(), worker(), worker()])
    return () => { cancelled = true }
  }, [expanded, cameras, wallCameras])

  useEffect(() => {
    if (!expanded) return
    const timer = window.setInterval(() => setWallVisualTick(value => value + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [expanded])
  useEffect(() => {
    if (!expanded) return
    setStreamFailures(current => {
      const visibleIds = new Set(wallCameras.map(camera => camera.id))
      const filtered = new Set([...current].filter(id => visibleIds.has(id)))
      return filtered.size === current.size ? current : filtered
    })
  }, [expanded, wallCameras])

  useEffect(() => {
    if (!expanded) return
    setWallPage(Math.min(wallPageCount - 1, Math.floor(activeIndex / wallPageSize)))
  }, [activeIndex, expanded, wallPageCount, wallPageSize])

  const health = activeCamera ? cameraHealth(activeCamera) : 'UNKNOWN'
  const media = activeCamera ? cameraMedia(activeCamera) : {}
  const kind = activeCamera ? mediaKind(activeCamera) : 'synthetic'
  const direct = activeCamera ? media.direct === true : false
  const directUrl = activeCamera ? mediaDirectUrl(activeCamera) : ''
  const attribution = activeCamera ? cameraMediaAttribution(activeCamera) : { name:'Public camera source', url:'' }
  const source = activeCamera ? cameraSource(activeCamera) : 'CCTV'
  const age = activeCamera ? frameAge(activeCamera) : null
  const mode = activeCamera ? sourceMode(activeCamera) : 'synthetic'
  const liveVideo = Boolean(activeCamera && liveVideoCapability(activeCamera))
  const whepLiveVideo = Boolean(activeCamera && whepVideoCapability(activeCamera))
  const platformVideo = Boolean(activeCamera && platformVideoCapability(activeCamera))
  const configuredStream = Boolean(activeCamera && direct && ['video','mjpeg'].includes(kind) && media.url)
  const operational = Boolean(
    activeCamera && (
      record(activeCamera.attributes).operational === true ||
      health === 'LIVE' ||
      (frameState === 'ready' && !synthetic)
    )
  )
  const sourcePlayback = activeCamera ? sourceMediaPlaybackKind(activeCamera) : null
  const label = whepLiveVideo
    ? 'LIVE VIDEO / WHEP'
    : platformVideo
      ? 'LIVE VIDEO / SANCTIONED PLATFORM'
      : configuredStream
      ? 'LIVE VIDEO / MULTI-SOURCE'
      : liveVideo
        ? 'LIVE VIDEO / PROVIDER'
        : direct
      ? 'PUBLIC PREVIEW'
      : sourcePlayback
        ? 'LIVE VIDEO / SOURCE'
        : mode === 'source'
          ? 'SOURCE-ONLY'
          : synthetic
            ? 'SYNTHETIC / FALLBACK'
            : operational
              ? 'LIVE / APPROVED SOURCE'
              : 'CATALOG / FALLBACK'
  const renderableCount = cameras.filter(camera => {
    const media = cameraMedia(camera)
    return (
      ((media.direct === true || providerSnapshotCapability(camera)) && ['image','video','mjpeg'].includes(mediaKind(camera))) ||
      sourceMediaPlaybackKind(camera) !== null
    )
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
    const camSourceMedia = sourceMediaUrl(camera)
    const camSourcePlayback = sourceMediaPlaybackKind(camera)
    const camMedia = cameraMedia(camera)
    const canPreview = (camMedia.direct === true || providerSnapshotCapability(camera)) && Boolean(mediaDirectUrl(camera)) && ['image'].includes(mediaKind(camera)) && !previewFailures.has(camera.id)
    const sourceFailed = previewFailures.has(camera.id)

    if (canPreview) {
      return (
        <div className={compact ? 'gev-cctv-wall-thumb gev-cctv-wall-thumb--image' : 'gev-cctv-tile-media gev-cctv-tile-media--image'}>
          {providerSnapshotCapability(camera)
            ? <InlineCctvSnapshot endpoint={providerSnapshotEndpoint(camera)} alt={`${cameraName(camera)} latest live snapshot`} />
            : <img src={mediaDirectUrl(camera)} alt={`${cameraName(camera)} latest preview`} loading={compact ? 'lazy' : 'eager'} decoding="async" />}
          <span className="gev-cctv-tile-sheen" />
        </div>
      )
    }

    if (!sourceFailed && camSourcePlayback === 'mjpeg') {
      return (
        <div className={compact ? 'gev-cctv-wall-thumb gev-cctv-wall-thumb--source-video' : 'gev-cctv-tile-media gev-cctv-tile-media--source-video'}>
          <img
            src={camSourceMedia}
            alt={`${cameraName(camera)} live MJPEG footage`}
            onError={() => markPreviewFailure(camera.id)}
          />
          <div className="gev-cctv-source-live-badge"><i /> LIVE · SOURCE</div>
        </div>
      )
    }

    if (!sourceFailed && camSourcePlayback === 'video') {
      return (
        <div className={compact ? 'gev-cctv-wall-thumb gev-cctv-wall-thumb--source-video' : 'gev-cctv-tile-media gev-cctv-tile-media--source-video'}>
          <InlineCctvVideo
            src={camSourceMedia}
            mediaType={sourceMediaType(camera)}
            poster={typeof camMedia.previewUrl === 'string' ? camMedia.previewUrl : undefined}
            onError={() => markPreviewFailure(camera.id)}
          />
          <div className="gev-cctv-source-live-badge"><i /> LIVE VIDEO · SOURCE</div>
        </div>
      )
    }

    const sourceImage = sourceMediaIsImage(camera)
    return (
      <div className={compact ? 'gev-cctv-wall-thumb gev-cctv-wall-thumb--source' : 'gev-cctv-tile-media gev-cctv-tile-media--source'}>
        <Camera size={compact ? 16 : 22} />
        <strong>{camMode === 'source' ? 'LIVE SOURCE NOT EMBEDDED' : camMode === 'synthetic' ? 'NO LIVE IMAGE' : 'PREVIEW UNAVAILABLE'}</strong>
        <span>{camMode === 'source'
          ? sourceImage
            ? 'The source currently exposes a still image only; Sonalit will not present it as live video.'
            : camSourceMedia
              ? 'A source URL exists, but it did not pass Sonalit’s approved in-app playback contract.'
              : 'The camera does not expose a browser-playable feed through an approved provider.'
          : camMode === 'synthetic'
            ? 'The source did not authorize a renderable preview.'
            : 'The approved media gateway has no current frame.'}</span>
      </div>
    )
  }

  return (
    <>
{!standalone && (      <aside ref={node => { wallRef.current = node }} className={`gev-cctv-panel${expanded ? ' gev-cctv-panel--expanded' : ''}`} aria-label="CCTV camera viewer">
        <div className="gev-cctv-head">
          <div className="gev-cctv-heading">
            <span className="gev-cctv-kicker"><Camera size={12} /> PUBLIC CAMERA NETWORK</span>
            <strong>CAMERA WALL</strong>
            <span>{cameras.length} cameras · {cameras.filter(camera => liveVideoCapability(camera)).length} live-video capable · {renderableCount} preview/stream · {sourceOnlyCount} publisher handoff{sourceOnlyCount === 1 ? '' : 's'}{publicTotal != null ? ` · ${publicTotal.toLocaleString()} public records` : ''}</span>
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
                {whepLiveVideo ? (
                  <InlineWhepVideo
                    camera={activeCamera}
                    onError={() => setFrameState('error')}
                  />
                ) : platformVideo && platformEmbedUrl(activeCamera) ? (
                  <InlinePlatformVideo
                    src={platformEmbedUrl(activeCamera)}
                    title={cameraName(activeCamera) + ' sanctioned live video'}
                  />
                ) : configuredStream && streamUrl ? (
                  kind === 'mjpeg' ? (
                    <img src={streamUrl} alt={`${cameraName(activeCamera)} live MJPEG stream`} />
                  ) : (
                    <InlineCctvVideo src={streamUrl} mediaType={cameraPlaybackMediaType(activeCamera)} onError={() => setFrameState('error')} />
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
              {mode === 'source' && <span> · SOURCE NOT EMBEDDED</span>}
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
      )}

      {expanded && activeCamera && (
        <div className={`gev-cctv-wall-overlay${standalone ? ' gev-cctv-wall-overlay--module' : ''}`} role="dialog" aria-modal="true" aria-label="CCTV Camera Wall">
          {!standalone && <div className="gev-cctv-wall-backdrop" onClick={() => setExpanded(false)} />}
          <section className="gev-cctv-wall" ref={node => { wallRef.current = node }}>
            <header className="gev-cctv-wall-head">
              <div className="gev-cctv-wall-head-copy">
                <span className="gev-cctv-kicker"><Camera size={12} /> LIVE SPATIAL SURVEILLANCE</span>
                <strong>CAMERA WALL</strong>
                <span>
                  {cameras.length} cameras · page {wallPage + 1}/{wallPageCount} · {wallCameras.filter(camera => liveVideoCapability(camera)).length} live-video capable on this page
                </span>
              </div>
              <div className="gev-cctv-wall-toolbar">
                <div className="gev-cctv-wall-metrics" aria-label="Camera wall metrics">
                  <span><i data-tone="live" />{wallCameras.filter(camera => cameraHealth(camera) === 'LIVE').length} LIVE</span>
                  <span><i data-tone="preview" />{wallCameras.filter(camera => cameraMedia(camera).direct === true).length} PREVIEW</span>
                  <span><i data-tone="source" />{wallCameras.filter(camera => sourceMode(camera) === 'source').length} SOURCE</span>
                </div>
                <div className="gev-cctv-layout-toggle" aria-label="Camera wall layout">
                  {([2, 3, 4] as const).map(layout => (
                    <button
                      key={layout}
                      type="button"
                      aria-pressed={wallLayout === layout}
                      onClick={() => {
                        setWallLayout(layout)
                        setWallPage(Math.min(Math.max(0, Math.ceil(cameras.length / (layout * layout)) - 1), Math.floor(activeIndex / (layout * layout))))
                      }}
                      title={`${layout} by ${layout} wall`}
                    >
                      {layout}×{layout}
                    </button>
                  ))}
                </div>
                <button type="button" className="gev-cctv-wall-nav" onClick={() => setWallPage(page => Math.max(0, page - 1))} disabled={wallPage <= 0} aria-label="Previous wall page" title="Previous wall page"><ChevronLeft size={15} /></button>
                <span className="gev-cctv-wall-page">{wallPage + 1}/{wallPageCount}</span>
                <button type="button" className="gev-cctv-wall-nav" onClick={() => setWallPage(page => Math.min(wallPageCount - 1, page + 1))} disabled={wallPage >= wallPageCount - 1} aria-label="Next wall page" title="Next wall page"><ChevronRight size={15} /></button>
                <button type="button" className="gev-cctv-wall-nav" onClick={() => void toggleBrowserFullscreen()} aria-label={browserFullscreen ? 'Exit browser fullscreen' : 'Browser fullscreen'} title="Browser fullscreen">{browserFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
                <button type="button" className="gev-cctv-wall-nav" onClick={() => setExpanded(false)} aria-label="Close expanded camera wall" title="Close"><X size={15} /></button>
              </div>
            </header>

            <div className={`gev-cctv-wall-feeds gev-cctv-wall-feeds--${wallLayout}`} role="grid" aria-label="Simultaneous CCTV camera feeds">
              {wallCameras.map(camera => {
                const cam = cameraDetails[camera.id] ? { ...camera, ...cameraDetails[camera.id] } : camera
                const camMedia = cameraMedia(cam)
                const camKind = mediaKind(cam)
                const camMode = sourceMode(cam)
                const camHealth = cameraHealth(cam)
                const camAge = frameAge(cam)
                const camSourceMedia = sourceMediaUrl(cam)
                const camSourcePlayback = sourceMediaPlaybackKind(cam)
                const camDirectUrl = mediaDirectUrl(cam)
                const camWallVisualUrl = camDirectUrl && providerSnapshotCapability(cam)
                  ? camDirectUrl + (camDirectUrl.includes('?') ? '&' : '?') + 'wallTick=' + wallVisualTick
                  : camDirectUrl
                const camPreviewable = (camMedia.direct === true || providerSnapshotCapability(cam)) && camKind === 'image' && Boolean(camDirectUrl) && !previewFailures.has(cam.id)
                const camStream = camMedia.direct === true && ['video', 'mjpeg'].includes(camKind) && Boolean(camMedia.url)
                const camStreamUrl = camStream ? streamUrlFor(cam) : ''
                const camStreamFailed = streamFailures.has(cam.id)
                const camLiveVideo = liveVideoCapability(cam)
                const camPlatformVideo = platformVideoCapability(cam)
                const isActive = cam.id === activeId
                return (
                  <article
                    key={cam.id}
                    className="gev-cctv-wall-feed"
                    data-active={isActive}
                    data-state={camHealth}
                    role="gridcell"
                  >
                    <div className="gev-cctv-wall-feed-media">
                      {camPlatformVideo ? (
                        isActive ? (
                          <div className="gev-cctv-wall-feed-media-source">
                            <InlinePlatformVideo
                              src={platformEmbedUrl(cam)}
                              title={cameraName(cam) + ' sanctioned live video'}
                            />
                            <span className="gev-cctv-wall-feed-source-badge"><i /> LIVE · PLATFORM</span>
                          </div>
                        ) : (
                          <div className="gev-cctv-wall-feed-state">
                            <Camera size={18} />
                            <strong>LIVE PLATFORM</strong>
                            <span>Select this camera to activate its sanctioned in-app player.</span>
                          </div>
                        )
                      ) : camStream && !camStreamFailed ? (
                        camKind === 'mjpeg' ? (
                          <div className="gev-cctv-wall-feed-media-source">
                            <img
                              src={camStreamUrl}
                              alt={`${cameraName(cam)} live MJPEG stream`}
                              loading="lazy"
                              decoding="async"
                              onError={() => setStreamFailures(current => {
                                const next = new Set(current)
                                next.add(cam.id)
                                return next
                              })}
                            />
                            <span className="gev-cctv-wall-feed-source-badge"><i /> LIVE · MJPEG</span>
                          </div>
                        ) : (
                          <div className="gev-cctv-wall-feed-media-source">
                            <InlineCctvVideo
                              src={camStreamUrl}
                              mediaType={cameraPlaybackMediaType(cam)}
                              poster={typeof camMedia.previewUrl === 'string' ? camMedia.previewUrl : undefined}
                              onError={() => setStreamFailures(current => {
                                const next = new Set(current)
                                next.add(cam.id)
                                return next
                              })}
                            />
                            <span className="gev-cctv-wall-feed-source-badge"><i /> LIVE · VIDEO</span>
                          </div>
                        )
                      ) : camLiveVideo ? (
                        camPreviewable ? (
                          <div className="gev-cctv-wall-feed-media-source">
                            {providerSnapshotCapability(cam)
                              ? <InlineCctvSnapshot
                                  endpoint={providerSnapshotEndpoint(cam)}
                                  alt={`${cameraName(cam)} latest live-video preview`}
                                  refreshKey={wallVisualTick}
                                />
                              : <img
                                  src={camWallVisualUrl}
                                  alt={`${cameraName(cam)} latest live-video preview`}
                                  loading="lazy"
                                  decoding="async"
                                  onError={() => markPreviewFailure(cam.id)}
                                />}
                            <span className="gev-cctv-wall-feed-source-badge"><i /> LIVE VIDEO · FALLBACK FRAME</span>
                          </div>
                        ) : (
                          <div className="gev-cctv-wall-feed-state">
                            <Camera size={18} />
                            <strong>LIVE VIDEO</strong>
                            <span>The continuous feed is currently unavailable in-app; select the camera to retry in the focused player.</span>
                          </div>
                        )
                      ) : camPreviewable ? (
                        providerSnapshotCapability(cam)
                          ? <InlineCctvSnapshot
                              endpoint={providerSnapshotEndpoint(cam)}
                              alt={`${cameraName(cam)} latest camera preview`}
                              refreshKey={wallVisualTick}
                            />
                          : <img
                              src={camWallVisualUrl}
                              alt={`${cameraName(cam)} latest camera preview`}
                              loading="lazy"
                              decoding="async"
                              onError={() => markPreviewFailure(cam.id)}
                            />
                      ) : camStream && isActive && streamUrl ? (
                        camKind === 'mjpeg'
                          ? <img src={streamUrl} alt={`${cameraName(cam)} live MJPEG stream`} onError={() => setFrameState('error')} />
                          : <InlineCctvVideo src={streamUrl} mediaType={cameraPlaybackMediaType(cam)} onError={() => setFrameState('error')} />
                      ) : camStream ? (
                        <div className="gev-cctv-wall-feed-state">
                          <Camera size={18} />
                          <strong>LIVE STREAM</strong>
                          <span>Select this camera to activate its approved stream.</span>
                        </div>
                      ) : camMode === 'source' ? (
                        camSourcePlayback === 'mjpeg' && !previewFailures.has(cam.id) && isActive ? (
                          <div className="gev-cctv-wall-feed-media-source">
                            <img
                              src={camSourceMedia}
                              alt={`${cameraName(cam)} live MJPEG footage`}
                              onError={() => markPreviewFailure(cam.id)}
                            />
                            <span className="gev-cctv-wall-feed-source-badge"><i /> LIVE · SOURCE</span>
                          </div>
                        ) : camSourcePlayback === 'video' && !previewFailures.has(cam.id) && isActive ? (
                          <div className="gev-cctv-wall-feed-media-source">
                            <InlineCctvVideo
                              src={camSourceMedia}
                              mediaType={sourceMediaType(cam)}
                              poster={typeof camMedia.previewUrl === 'string' ? camMedia.previewUrl : undefined}
                              onError={() => markPreviewFailure(cam.id)}
                            />
                            <span className="gev-cctv-wall-feed-source-badge"><i /> LIVE VIDEO · SOURCE</span>
                          </div>
                        ) : (
                          <div className="gev-cctv-wall-feed-state gev-cctv-wall-feed-state--source">
                            <Camera size={18} />
                            <strong>{sourceMediaIsImage(cam) ? 'LIVE FRAME ONLY' : camSourcePlayback ? 'LIVE VIDEO READY' : 'LIVE SOURCE UNAVAILABLE'}</strong>
                            <span>
                              {sourceMediaIsImage(cam)
                                ? 'Current source is a live-updating image, not a continuous video stream.'
                                : camSourcePlayback
                                  ? 'Select this camera to play its live source inside the wall.'
                                  : 'The source does not expose an approved in-app browser-playable feed.'}
                            </span>
                          </div>
                        )
                      ) : (
                        <div className="gev-cctv-wall-feed-state">
                          <Camera size={18} />
                          <strong>{camMode === 'synthetic' ? 'NO APPROVED PREVIEW' : 'PREVIEW UNAVAILABLE'}</strong>
                          <span>{camMode === 'synthetic' ? 'The source did not authorize a renderable camera frame.' : 'The approved media gateway has no current frame.'}</span>
                        </div>
                      )}
                      {!((camStream || camSourcePlayback === 'video' || camPlatformVideo) && isActive) && (
                        <button
                          type="button"
                          className="gev-cctv-wall-feed-hit"
                          onClick={() => {
                            onSelectCamera(cam.id)
                            setZoom(1)
                          }}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              onSelectCamera(cam.id)
                              setZoom(1)
                            }
                          }}
                          aria-label={`Select ${cameraName(cam)}`}
                        />
                      )}
                      <div className="gev-cctv-wall-feed-top">
                        <span className="gev-cctv-wall-feed-index">{String(wallPage * wallPageSize + wallCameras.indexOf(camera) + 1).padStart(2, '0')}</span>
                        <span className="gev-cctv-wall-feed-state-pill" data-state={camHealth}><i />{camHealth}</span>
                        <span className="gev-cctv-wall-feed-type">{camKind.toUpperCase()}</span>
                      </div>
                      {isActive && <span className="gev-cctv-wall-feed-selected">FOCUSED</span>}
                    </div>
                    <div className="gev-cctv-wall-feed-copy">
                      <div>
                        <strong>{cameraName(cam)}</strong>
                        <span>{cameraSource(cam)}{camAge ? ` · ${camAge}` : ''}</span>
                      </div>
                      <span className="gev-cctv-wall-feed-coords">{Number(cam.latitude).toFixed(4)}°, {Number(cam.longitude).toFixed(4)}°</span>
                    </div>
                  </article>
                )
              })}
            </div>

            <footer className="gev-cctv-wall-foot">
              <span><strong>WALL {wallLayout}×{wallLayout}</strong> · click a tile to focus live footage · ←/→ navigate cameras</span>
              <span>{activeCamera ? cameraName(activeCamera) : 'No camera selected'}{age ? ` · selected frame ${age}` : ''}</span>
            </footer>
          </section>
        </div>
      )}
    </>
  )
}