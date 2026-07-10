package io.sonalit.guardian.data.local

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Last-successful-heartbeat timestamp, read by HomeScreen to show real status
 * instead of a hardcoded "Just now". Plain (non-encrypted) prefs — this is
 * just a millis timestamp, not enrollment/auth material.
 */
@Singleton
class HeartbeatStatusStore @Inject constructor(@ApplicationContext context: Context) {
    private val prefs = context.getSharedPreferences("guardian_status", Context.MODE_PRIVATE)

    fun recordSuccess() {
        prefs.edit().putLong(KEY_LAST_HEARTBEAT_AT, System.currentTimeMillis()).apply()
    }

    fun lastHeartbeatAt(): Long? =
        prefs.getLong(KEY_LAST_HEARTBEAT_AT, -1L).takeIf { it > 0 }

    companion object {
        private const val KEY_LAST_HEARTBEAT_AT = "last_heartbeat_at"
    }
}
