import axios from 'axios';
import type { SealVerification, SealStatus } from '../types/SealEntry';

const BASE = (import.meta.env.VITE_API_BASE ?? '') + '/api/v1/guardian/convoy';

export const sealApi = {
  submitVerification: (
    seal_id: string,
    convoy_id: string,
    phase: 'sod' | 'eod',
    photo_id: string | null,
    status: SealStatus,
    lat: number | null,
    lng: number | null,
    token: string
  ): Promise<SealVerification> =>
    axios
      .post(
        `${BASE}/seal-verifications`,
        { seal_id, convoy_id, phase, photo_id, status, lat, lng },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      .then(r => r.data.data),

  reportTamper: (
    seal_id: string,
    convoy_id: string,
    lat: number | null,
    lng: number | null,
    token: string
  ) =>
    axios
      .post(
        `${BASE}/seal-verifications`,
        { seal_id, convoy_id, phase: 'sod', photo_id: null, status: 'tampered', lat, lng },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      .then(r => r.data.data),
};
