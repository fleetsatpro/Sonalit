import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Camera, ChevronLeft, Globe2, RefreshCw, ShieldCheck } from 'lucide-react'
import { api } from '../lib/api.js'
import CctvViewerPanel from '../components/geofences/CctvViewerPanel.js'
import type { SpatialWorldEntity } from '../lib/spatialClient.js'
import '../styles/cctv-wall.css'
import '../styles/surveillance-camera-wall.css'

type CameraScope = 'kenya' | 'east-africa'

const SCOPES: Record<CameraScope, {
  label: string
  bbox: [number, number, number, number]
  description: string
}> = {
  kenya: {
    label: 'Kenya',
    bbox: [33.8, -4.8, 42.0, 5.2],
    description: 'National public-camera coverage',
  },
  'east-africa': {
    label: 'East Africa',
    bbox: [28, -12, 52, 16],
    description: 'Regional public-camera coverage',
  },
}

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
  const [scope, setScope] = useState<CameraScope>('kenya')
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const selectedScope = SCOPES[scope]

  const { data, isFetching, isError } = useQuery<CctvResult>({
    queryKey: ['surveillance-camera-wall', scope, refreshKey],
    queryFn: async () => {
      const response = await api.get<CctvResult>('/cctv/cameras', {
        params: {
          bbox: selectedScope.bbox.join(','),
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

  const publicTotal =
    data?.coverage?.providers?.openeye?.free ??
    data?.coverage?.providers?.openeye?.total ??
    cameras.length

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
            <p>{selectedScope.description} · provenance preserved · publisher boundaries respected</p>
          </div>
        </div>

        <div className="surveillance-camera-wall-page-controls">
          <div className="surveillance-camera-wall-scope" aria-label="Camera coverage scope">
            {(Object.keys(SCOPES) as CameraScope[]).map(key => (
              <button
                key={key}
                type="button"
                aria-pressed={scope === key}
                onClick={() => {
                  setScope(key)
                  setSelectedCameraId(null)
                }}
              >
                <Globe2 size={12} />
                {SCOPES[key].label}
              </button>
            ))}
          </div>
          <div className="surveillance-camera-wall-health">
            <span className="surveillance-camera-wall-health-dot" />
            <span>{isError ? 'DEGRADED' : isFetching ? 'SYNCING' : 'CONNECTED'}</span>
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
        <span><strong>{cameras.length}</strong> in scope</span>
        <span><strong>{publicTotal.toLocaleString()}</strong> public records</span>
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
