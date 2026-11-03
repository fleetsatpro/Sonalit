import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Camera, ChevronLeft, Globe2, RefreshCw, ShieldCheck } from 'lucide-react'
import { api } from '../lib/api.js'
import CctvViewerPanel from '../components/geofences/CctvViewerPanel.js'
import type { SpatialWorldEntity } from '../lib/spatialClient.js'
import '../styles/cctv-wall.css'
import '../styles/surveillance-camera-wall.css'

interface CameraCountry {
  code: string
  name: string
}

const GLOBAL_COUNTRY = { code: 'GLOBAL', name: 'Global' }

interface CctvResult {
  data: SpatialWorldEntity[]
  health?: { recordCount?: number; acceptedCount?: number; status?: string }
  coverage?: {
    complete?: boolean
    bounded?: boolean
    queryScope?: string
    providers?: Record<string, { status?: string; recordCount?: number; total?: number | null; free?: number | null }>
  }
  warnings?: string[]
}

export default function SurveillanceCameraWall() {
  const navigate = useNavigate()
  const [countryCode, setCountryCode] = useState('KE')
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const liveOnly = true
  const includeSnapshots = true

  const { data: countryData } = useQuery<{ data: CameraCountry[] }>({
    queryKey: ['surveillance-camera-countries'],
    queryFn: async () => (await api.get<{ data: CameraCountry[] }>('/cctv/countries')).data,
    staleTime: 86_400_000,
  })

  const countries = useMemo(
    () => [GLOBAL_COUNTRY, ...(countryData?.data ?? [])],
    [countryData],
  )

  const selectedCountry = countries.find(country => country.code === countryCode) ?? GLOBAL_COUNTRY

  const { data, isFetching, isError } = useQuery<CctvResult>({
    queryKey: ['surveillance-camera-wall', countryCode, refreshKey],
    queryFn: async () => {
      const response = await api.get<CctvResult>('/cctv/cameras', {
        params: {
          ...(countryCode !== 'GLOBAL' ? { country: countryCode } : {}),
          liveOnly,
          includeSnapshots,
          limit: 250,
        },
      })
      return response.data
    },
    staleTime: 45_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  const cameras = useMemo(
    () => (data?.data ?? []).filter(camera =>
      Number.isFinite(camera.latitude) && Number.isFinite(camera.longitude)
    ),
    [data],
  )

  const publicDirectoryRecords =
    Number(data?.coverage?.providers?.opencctv?.recordCount ?? 0) +
    Number(data?.coverage?.providers?.openeye?.free ?? 0)
  const publicTotal = publicDirectoryRecords ||
    data?.coverage?.providers?.openeye?.total ||
    cameras.length

  const videoCapableSourceCount = cameras.filter(camera => {
    const media = ((camera.attributes?.media ?? {}) as Record<string, unknown>)
    const kind = String(media.kind ?? '').toLowerCase()
    return media.liveVideo === true ||
      Boolean(media.platformEmbedUrl) ||
      (media.direct === true && ['video', 'mjpeg'].includes(kind)) ||
      media.sourceMediaPlayable === true
  }).length

  const snapshotCapableCount = cameras.filter(camera => {
    const media = ((camera.attributes?.media ?? {}) as Record<string, unknown>)
    const kind = String(media.kind ?? '').toLowerCase()
    return kind === 'image' &&
      (media.providerFrameAvailable === true ||
        (media.direct === true && Boolean(media.frameUrl || media.previewUrl || media.url)))
  }).length

  return (
    <main className="surveillance-camera-wall-page">
      <header className="surveillance-camera-wall-page-head">
        <div className="surveillance-camera-wall-page-identity">
          <button
            type="button"
            className="surveillance-camera-wall-back"
            onClick={() => void navigate({ to: '/surveillance' })}
            aria-label="Back to Surveillance"
            title="Back to Surveillance"
          >
            <ChevronLeft size={15} />
            <span>SURVEILLANCE</span>
          </button>
          <div className="surveillance-camera-wall-page-icon" aria-hidden="true">
            <Camera size={19} />
          </div>
          <div>
            <div className="surveillance-camera-wall-page-kicker">SURVEILLANCE · MODULE</div>
            <h1>Camera Wall</h1>
            <p>{selectedCountry.name} · provider-reported video and snapshot capabilities; playback and frame freshness are verified only after in-app acquisition</p>
          </div>
        </div>

        <div className="surveillance-camera-wall-page-controls">
          <label className="surveillance-camera-wall-country" title="Choose a camera country">
            <Globe2 size={12} />
            <span>COUNTRY</span>
            <select
              value={countryCode}
              onChange={event => {
                setCountryCode(event.target.value)
                setSelectedCameraId(null)
              }}
              aria-label="Camera country"
            >
              {countries.map(country => (
                <option key={country.code} value={country.code}>{country.name}</option>
              ))}
            </select>
          </label>
          <div className="surveillance-camera-wall-live-only" aria-label="Source and playback status">
            <span className="surveillance-camera-wall-live-only-dot" />
            SOURCE STATUS ≠ PLAYBACK PROOF
          </div>
          <div className="surveillance-camera-wall-health">
            <span className="surveillance-camera-wall-health-dot" />
            <span>{isError ? 'DEGRADED' : isFetching ? 'SYNCING' : cameras.length ? 'CATALOG LOADED' : 'NO CAMERA RECORDS'}</span>
          </div>
          <button
            type="button"
            className="surveillance-camera-wall-refresh"
            onClick={() => setRefreshKey(value => value + 1)}
            aria-label="Refresh camera catalog"
            title="Refresh camera catalog"
          >
            <RefreshCw size={13} className={isFetching ? 'is-spinning' : ''} />
            Refresh
          </button>
        </div>
      </header>

      <section className="surveillance-camera-wall-page-summary" aria-label="Camera wall status">
        <span><strong>{cameras.length}</strong> catalog entries in {selectedCountry.name}</span>
        <span><strong>{videoCapableSourceCount}</strong> video-capable records · playback unverified</span>
        <span><strong>{snapshotCapableCount}</strong> snapshot-capable sources</span>
        <span><strong>{publicTotal.toLocaleString()}</strong> public directory records</span>
        <span><ShieldCheck size={12} /> Source attribution enforced</span>
        <span>No person / face / plate tracking</span>
      </section>

      <div className="surveillance-camera-wall-stage">
        <CctvViewerPanel
          cameras={cameras}
          publicTotal={publicTotal}
          selectedCameraId={selectedCameraId}
          loading={isFetching && cameras.length === 0}
          error={isError}
          standalone
          onSelectCamera={setSelectedCameraId}
          onClose={() => void navigate({ to: '/surveillance' })}
        />
      </div>
    </main>
  )
}
