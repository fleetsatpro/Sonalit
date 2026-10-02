import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { Crosshair, DatabaseZap, Eye, Gauge, Loader2, Play, ScanSearch, ShieldCheck, Sparkles, Timer, Truck, Waypoints, X } from 'lucide-react';
import CorridorWorldScene, { type GlobeMember, type LatLng, type RiskZone } from './CorridorWorldScene.js';
import CorridorOperationalMap from './CorridorOperationalMap.js';
import { runXdSurveillanceAgents, type XdDimension } from './xdSurveillanceAgents.js';
import type { SpatialWorldEntity } from '../../lib/spatialClient.js';
import '../../styles/spatial-command.css';

export type { LatLng, GlobeMember, RiskZone };
type Surface = 'corridor' | 'gev';
type Props = { convoyId?: string; route: LatLng[]; corridorKm: number; members: GlobeMember[]; zones?: RiskZone[]; ceilingM?: number; focusId?: string | null; trail?: LatLng[]; onSelect?: (id: string | null) => void; onExternalSelect?: (id: string | null) => void; selectedExternalId?: string | null; worldEntities?: SpatialWorldEntity[]; onViewportChange?: (viewport: { latitude: number; longitude: number; radiusM: number }) => void; fill?: boolean; surface?: Surface; fixedView?: View; showChrome?: boolean; showMapControls?: boolean };
type View = '2D' | '3D';