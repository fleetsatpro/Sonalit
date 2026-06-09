import axios from 'axios';
import type { ConvoyReport, GPS, PhotoUpload } from '../types/ConvoyReport';

// PhotoUpload imported for re-export / future use in composed calls
export type { PhotoUpload };

const BASE = (import.meta.env.VITE_API_BASE ?? '') + '/api/v1/guardian/convoy';

function headers(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export const reportApi = {
  login: (cfo_id: string, pin: string, convoy_id: string) =>
    axios.post(`${BASE}/login`, { cfo_id, pin, convoy_id }).then(r => r.data),

  getReport: (convoy_id: string, token: string): Promise<ConvoyReport> =>
    axios
      .get(`${BASE}/convoy-reports/${convoy_id}`, { headers: headers(token) })
      .then(r => r.data.data),

  submitArrival: (report_id: string, gps: GPS, token: string) =>
    axios
      .post(
        `${BASE}/convoy-reports/${report_id}/arrival`,
        {
          lat: gps.lat,
          lng: gps.lng,
          accuracy: gps.accuracy,
          timestamp: new Date().toISOString(),
        },
        { headers: headers(token) }
      )
      .then(r => r.data.data),

  submitSOD: (report_id: string, photos: string[], gps: GPS, token: string) =>
    axios
      .post(
        `${BASE}/convoy-reports/${report_id}/sod`,
        { photos, gps, submitted_at: new Date().toISOString() },
        { headers: headers(token) }
      )
      .then(r => r.data.data),

  submitEOD: (report_id: string, photos: string[], gps: GPS, token: string) =>
    axios
      .post(
        `${BASE}/convoy-reports/${report_id}/eod`,
        { photos, gps, submitted_at: new Date().toISOString() },
        { headers: headers(token) }
      )
      .then(r => r.data.data),

  getHistory: (token: string): Promise<ConvoyReport[]> =>
    axios
      .get(`${BASE}/history`, { headers: headers(token) })
      .then(r => r.data.data),
};
