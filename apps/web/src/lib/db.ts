import Dexie, { type EntityTable } from 'dexie';

type GpsFix = { id: string; device_id: string; lat: number; lon: number; ts: number };
type PendingUpload = { id: string; kind: string; payload: string; created_at: number };

class SonalitDB extends Dexie {
  gps_fixes!: EntityTable<GpsFix, 'id'>;
  pending_uploads!: EntityTable<PendingUpload, 'id'>;

  constructor() {
    super('sonalit');
    this.version(1).stores({
      gps_fixes: 'id, device_id, ts',
      pending_uploads: 'id, kind, created_at',
    });
  }
}

export const db = new SonalitDB();
