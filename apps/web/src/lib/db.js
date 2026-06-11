import Dexie from 'dexie';
class SonalitDB extends Dexie {
    gps_fixes;
    pending_uploads;
    constructor() {
        super('sonalit');
        this.version(1).stores({
            gps_fixes: 'id, device_id, ts',
            pending_uploads: 'id, kind, created_at',
        });
    }
}
export const db = new SonalitDB();
