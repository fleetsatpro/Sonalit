import axios from 'axios';
import type { PhotoType, Phase, PhotoUpload } from '../types/ConvoyReport';

const BASE = (import.meta.env.VITE_API_BASE ?? '') + '/api/v1/guardian/convoy';

export const uploadApi = {
  getUploadUrl: (
    photo_type: PhotoType,
    convoy_id: string,
    phase: Phase,
    plate_number: string,
    token: string
  ) =>
    axios
      .post(
        `${BASE}/photos/upload-url`,
        { photo_type, convoy_id, phase, plate_number },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      .then(r => r.data),

  uploadToR2: (upload_url: string, blob: Blob) =>
    fetch(upload_url, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': 'image/jpeg' },
    }),

  commitPhoto: (
    photo_id: string,
    photo_type: PhotoType,
    convoy_id: string,
    phase: Phase,
    lat: number,
    lng: number,
    accuracy: number,
    plate_number: string,
    token: string
  ): Promise<PhotoUpload> =>
    axios
      .post(
        `${BASE}/photos/commit`,
        {
          photo_id,
          photo_type,
          convoy_id,
          phase,
          lat,
          lng,
          accuracy,
          plate_number,
          timestamp: new Date().toISOString(),
        },
        { headers: { Authorization: `Bearer ${token}` } }
      )
      .then(r => r.data.data),
};
