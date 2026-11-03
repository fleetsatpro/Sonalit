export type IncidentType =
  | 'armed_attack'
  | 'robbery_hijack'
  | 'breakdown'
  | 'medical'
  | 'unspecified';

export interface SOSEvent {
  id: string;
  convoy_id: string;
  cfo_id: string;
  incident_type: IncidentType;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  acknowledged: boolean;
  created_at: string;
}
