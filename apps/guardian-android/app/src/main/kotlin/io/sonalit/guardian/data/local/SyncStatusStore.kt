package io.sonalit.guardian.data.local

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Last-successful-GPS-sync timestamp, recorded by SyncWorker. HomeScreen used
 * to read only the local Room DB's most recent buffered fix for its "GPS"
 * status card — GuardianService keeps writing a fix every 30s regardless of
 * whether SyncWorker can ever reach the server, so that showed "Active" the
 * entire time the telemetry endpoint was silently 404ing (see the
 * telemetry/batch -> guardian/location/batch fix). This tracks whether
 * location data is actually leaving the device, which is the thing that
 * matters to dispatch.
 */
@Singleton
class SyncStatusStore @Inject constructor(@ApplicationContext context: Context) {
    private val prefs = context.getSharedPreferences("guardian_status", Context.MODE_PRIVATE)

    fun recordSuccess() {
        prefs.edit().putLong(KEY_LAST_SYNC_AT, System.currentTimeMillis()).apply()
    }

    fun lastSyncAt(): Long? =
        prefs.getLong(KEY_LAST_SYNC_AT, -1L).takeIf { it > 0 }

    companion object {
        private const val KEY_LAST_SYNC_AT = "last_gps_sync_at"
    }
}
