package com.fleetops.guardian.service

import android.content.Context
import android.util.Log
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.work.*
import com.fleetops.guardian.data.prefs.DevicePrefs
import com.fleetops.guardian.data.repository.GuardianRepository
import com.fleetops.guardian.data.repository.PanicMode
import com.fleetops.guardian.data.repository.RepositoryResult
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Manages the Dead Man's Switch (DMS) lifecycle on the device.
 *
 * DMS requires the field officer to check in within a configurable interval.
 * If the interval elapses without a check-in, the device automatically
 * triggers a silent panic with trigger_type = "dms_timeout".
 *
 * Check-ins are sent both locally (updating last_checkin_ms) and to the server
 * via POST /guardian/checkin so the server can also detect missed check-ins.
 */
@Singleton
class DeadMansSwitchManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val repository: GuardianRepository,
    private val devicePrefs: DevicePrefs,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val workManager = WorkManager.getInstance(context)

    // ─── Public API ───────────────────────────────────────────────────────────

    fun enable(timeoutMinutes: Int) {
        saveDmsPrefs(enabled = true, timeoutMinutes = timeoutMinutes)
        recordCheckin()
        scheduleMonitor()
        Log.i(TAG, "DMS enabled — timeout ${timeoutMinutes}m")
    }

    fun disable() {
        saveDmsPrefs(enabled = false, timeoutMinutes = 0)
        workManager.cancelUniqueWork(WORK_NAME)
        Log.i(TAG, "DMS disabled")
    }

    /** Call on any deliberate user interaction that constitutes a check-in. */
    fun recordCheckin() {
        scope.launch {
            devicePrefs.setDmsLastCheckin(System.currentTimeMillis())
            when (val r = repository.dmsCheckin()) {
                is RepositoryResult.Success -> Log.d(TAG, "DMS server check-in ok")
                is RepositoryResult.Error -> Log.w(TAG, "DMS server check-in failed: ${r.message}")
            }
        }
    }

    /** Called by DmsMonitorWorker — returns true if panic was triggered. */
    suspend fun evaluateTimeout(): Boolean {
        val prefs = devicePrefs.dmsPrefs()
        if (!prefs.enabled) return false

        val suspendedUntil = prefs.suspendedUntilMs
        if (suspendedUntil > 0 && System.currentTimeMillis() < suspendedUntil) {
            Log.d(TAG, "DMS suspended until ${suspendedUntil}")
            return false
        }

        val timeoutMs = prefs.timeoutMinutes * 60_000L
        val elapsed = System.currentTimeMillis() - prefs.lastCheckinMs
        if (elapsed < timeoutMs) return false

        Log.w(TAG, "DMS timeout exceeded (${elapsed / 60_000}m) — triggering silent panic")
        when (val r = repository.triggerPanic(PanicMode.SILENT, "DMS timeout — missed check-in")) {
            is RepositoryResult.Success -> Log.i(TAG, "DMS panic sent: incident=${r.data.incidentId}")
            is RepositoryResult.Error -> Log.e(TAG, "DMS panic failed: ${r.message}")
        }
        // Disable after trigger to avoid spam; operator must re-enable via command
        disable()
        return true
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    private fun scheduleMonitor() {
        val request = PeriodicWorkRequestBuilder<DmsMonitorWorker>(
            repeatInterval = MONITOR_INTERVAL_MINUTES,
            repeatIntervalTimeUnit = TimeUnit.MINUTES,
        )
            .setConstraints(
                Constraints.Builder()
                    .setRequiresBatteryNotLow(false)
                    .build()
            )
            .setBackoffCriteria(BackoffPolicy.LINEAR, 1, TimeUnit.MINUTES)
            .addTag(TAG)
            .build()

        workManager.enqueueUniquePeriodicWork(
            WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request,
        )
    }

    private fun saveDmsPrefs(enabled: Boolean, timeoutMinutes: Int) {
        scope.launch { devicePrefs.setDmsConfig(enabled, timeoutMinutes) }
    }

    companion object {
        private const val TAG = "DeadMansSwitchManager"
        private const val WORK_NAME = "dms_monitor"
        private const val MONITOR_INTERVAL_MINUTES = 1L
    }
}

// ─── DMS Prefs holder ─────────────────────────────────────────────────────────

data class DmsPrefs(
    val enabled: Boolean,
    val timeoutMinutes: Int,
    val lastCheckinMs: Long,
    val suspendedUntilMs: Long,
)
