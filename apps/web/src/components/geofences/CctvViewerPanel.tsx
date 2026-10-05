import {
  Camera, ChevronLeft, ChevronRight, ExternalLink, Expand, Maximize2, Minimize2,
  RefreshCw, RotateCcw, ZoomIn, ZoomOut, X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../lib/api.js'
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

function mediaDirectUrl(camera: SpatialWorldEntity) {
  const media = cameraMedia(camera)
  return String(media.previewUrl ?? media.frameUrl ?? media.url ?? '').trim()
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

function platformEmbedUrl(camera: SpatialWorldEntity) {
  return String(cameraMedia(camera).platformEmbedUrl ?? '').trim()
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
  return cameraMedia(camera).liveVideo === true && String(camera.id).startsWith('openeye:')
}

function inlineVideoCapability(camera: SpatialWorldEntity) {
  const media = cameraMedia(camera)
  const health = cameraHealth(camera)
  return health === 'LIVE' && (
    liveVideoCapability(camera) ||
    platformEmbedUrl(camera) !== '' ||
    (media.direct === true && ['video', 'mjpeg'].includes(mediaKind(camera))) ||
    sourceMediaPlaybackKind(camera) !== null
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