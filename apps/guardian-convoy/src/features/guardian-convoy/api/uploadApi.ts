import axios from 'axios';
import type { PhotoType, Phase, PhotoUpload } from '../types/ConvoyReport';

const BASE = (import.meta.env.VITE_API_BASE ?? '') + '/api/v1/guardian/convoy';

export const uploadApi = {
  uploadPhoto: (
    file: File,
    photo_type: PhotoType,
    convoy_id: string,
    phase: Phase,
    lat: number,
    lng: number,
    accuracy: number,
    plate_number: string,
    token: string
  ): Promise<PhotoUpload> => {
    const params = new URLSearchParams({
      photo_type,
      convoy_id,
      phase,
      plate_number,
      lat: String(lat),
      lng: String(lng),
      accuracy: String(Math.round(accuracy)),
    });
    return axios
      .post(`${BASE}/photos/upload?${params}`, file, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': file.type || 'image/jpeg',
        },
      })
      .then(r => ({ photo_id: r.data.photo_id, photo_type, r2_url: r.data.r2_url, phase }));
  },

  uploadHandoverForm: (
    file: File,
    convoy_id: string,
    report_id: string,
    token: string
  ): Promise<{ r2_url: string }> => {
    const params = new URLSearchParams({ convoy_id, report_id });
    return axios
      .post(`${BASE}/handover/upload?${params}`, file, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': file.type || 'application/octet-stream',
        },
      })
      .then(r => ({ r2_url: r.data.r2_url }));
  },
};
