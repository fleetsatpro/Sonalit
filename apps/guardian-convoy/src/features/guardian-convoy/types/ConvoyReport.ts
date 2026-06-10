export interface GPS {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface ConvoyTruck {
  id: string;
  plate: string;
  position: number;
  type: string;
}

export interface ConvoySeal {
  id: string;
  serial: string;
  vehicle_plate: string;
  position: string;
}

export interface ConvoyMeta {
  id: string;
  origin: string;
  destination: string;
  distance_km: number;
  trucks: ConvoyTruck[];
  seals: ConvoySeal[];
}

export interface CfoUser {
  id: string;
  name: string;
  initials: string;
}

export interface AuthState {
  token: string;
  cfo: CfoUser;
  convoy: ConvoyMeta;
}

export interface ConvoyReport {
  id: string;
  convoy_id: string;
  cfo_id: string;
  date: string;
  status: 'in_progress' | 'sod_complete' | 'eod_complete';
  convoy_status?: string;
  sod_submitted_at: string | null;
  eod_submitted_at: string | null;
  arrival_at: string | null;
  arrival_lat: number | null;
  arrival_lng: number | null;
  pdf_url: string | null;
  handover_form_url?: string | null;
}

export type PhotoType =
  | 'vehicle_front'
  | 'cargo_seal'
  | 'cargo_interior'
  | 'cfo_identity'
  | 'tyres_under'
  | 'vehicle_arrival'
  | 'seals_eod'
  | 'offload_docs'
  | 'delivery_point'
  | 'receiver_signature'
  | 'handover_form';

export type Phase = 'sod' | 'eod';

export interface PhotoUpload {
  photo_id: string;
  r2_url: string;
  photo_type: PhotoType;
  phase: Phase;
}
