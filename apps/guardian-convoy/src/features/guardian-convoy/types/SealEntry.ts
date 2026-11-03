export type SealStatus = 'ok' | 'tampered' | 'missing';

export interface SealVerification {
  id: string;
  seal_serial: string;
  vehicle_plate: string;
  position: string;
  phase: 'sod' | 'eod';
  photo_id: string | null;
  status: SealStatus;
  lat: number | null;
  lng: number | null;
  verified_at: string;
}

export interface SealDisplayEntry {
  seal_id: string;
  serial: string;
  plate: string;
  position: string;
  sodPhoto: string | null;
  eodPhoto: string | null;
  sodStatus: SealStatus | null;
  eodStatus: SealStatus | null;
}
