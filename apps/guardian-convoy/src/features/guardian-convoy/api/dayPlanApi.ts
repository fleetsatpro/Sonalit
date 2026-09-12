import axios from 'axios';
import type { DayPlan, NewWaypoint } from '../types/ConvoyReport';

const BASE = (import.meta.env.VITE_API_BASE ?? '') + '/api/v1/guardian/convoy';

function headers(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export const dayPlanApi = {
  getToday: (convoy_id: string, token: string): Promise<DayPlan | null> =>
    axios
      .get(`${BASE}/day-plan/${convoy_id}`, { headers: headers(token) })
      .then(r => r.data.plan),

  create: (
    payload: {
      convoy_id: string;
      start_label?: string;
      start_lat?: number;
      start_lng?: number;
      night_park_label: string;
      night_park_lat?: number;
      night_park_lng?: number;
      waypoints: NewWaypoint[];
    },
    token: string
  ): Promise<DayPlan> =>
    axios.post(`${BASE}/day-plan`, payload, { headers: headers(token) }).then(r => r.data.plan),

  modify: (
    plan_id: string,
    payload: {
      night_park_label?: string;
      night_park_lat?: number;
      night_park_lng?: number;
      waypoints?: NewWaypoint[];
      modified_reason?: string;
    },
    token: string
  ): Promise<DayPlan> =>
    axios.patch(`${BASE}/day-plan/${plan_id}`, payload, { headers: headers(token) }).then(r => r.data.plan),

  reachWaypoint: (plan_id: string, waypoint_id: string, lat: number, lng: number, token: string) =>
    axios
      .post(`${BASE}/day-plan/${plan_id}/waypoints/${waypoint_id}/reach`, { lat, lng }, { headers: headers(token) })
      .then(r => r.data.waypoint),
};
