import axios from 'axios';
import type { SOSEvent, IncidentType } from '../types/SOSEvent';

const BASE = (import.meta.env.VITE_API_BASE ?? '') + '/api/v1/guardian/convoy';

export const sosApi = {
  sendPanic: (
    convoy_id: string,
    cfo_id: string,
    incident_type: IncidentType,
    lat: number | null,
    lng: number | null,
    accuracy: number | null,
    token: string
  ): Promise<SOSEvent> =>
    axios
      .post(
        `${BASE}/sos-events`,
        {
          convoy_id,
          cfo_id,
          incident_type,
          lat,
          lng,
          accuracy,
          timestamp: new Date().toISOString(),
        },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      .then(r => r.data.data),
};
