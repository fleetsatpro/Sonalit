package com.fleetops.guardian.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.work.*
import com.fleetops.guardian.GuardianApplication
import com.fleetops.guardian.data.prefs.DevicePrefs
import com.fleetops.guardian.service.GuardianService
import com.fleetops.guardian.worker.HeartbeatWorker
import com.fleetops.guardian.worker.SyncWorker
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit
import javax.inject.Inject

@AndroidEntryPoint
class BootReceiver : BroadcastReceiver() {

    @Inject
    lateinit var devicePrefs: DevicePrefs

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        Log.i(TAG, "Received broadcast: $action")

        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED) {
            return
        }

        scope.launch {
            val enrolled = devicePrefs.isEnrolled()
            Log.i(TAG, "Boot complete — enrolled=$enrolled")

            if (enrolled) {
                // Start foreground service
                GuardianService.startService(context)

                // Re-schedule WorkManager jobs (they survive reboot but let's ensure)
                scheduleWorkManagerJobs(context)

                Log.i(TAG, "Guardian service started after boot")
            }
        }
    }

    private fun scheduleWorkManagerJobs(context: Context) {
        val workManager = WorkManager.getInstance(context)

        val heartbeatConstraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val heartbeatRequest = PeriodicWorkRequestBuilder<HeartbeatWorker>(
            repeatInterval = 60L,
            repeatIntervalTimeUnit = TimeUnit.SECONDS
        )
            .setConstraints(heartbeatConstraints)
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                WorkRequest.MIN_BACKOFF_MILLIS,
                TimeUnit.MILLISECONDS
            )
            .addTag(GuardianApplication.TAG_HEARTBEAT)
            .build()

        workManager.enqueueUniquePeriodicWork(
            GuardianApplication.WORK_HEARTBEAT,
            ExistingPeriodicWorkPolicy.KEEP,
            heartbeatRequest
        )

        val syncConstraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val syncRequest = PeriodicWorkRequestBuilder<SyncWorker>(
            repeatInterval = 5L,
            repeatIntervalTimeUnit = TimeUnit.MINUTES
        )
            .setConstraints(syncConstraints)
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                WorkRequest.MIN_BACKOFF_MILLIS,
                TimeUnit.MILLISECONDS
            )
            .addTag(GuardianApplication.TAG_SYNC)
            .build()

        workManager.enqueueUniquePeriodicWork(
            GuardianApplication.WORK_SYNC,
            ExistingPeriodicWorkPolicy.KEEP,
            syncRequest
        )

        Log.i(TAG, "WorkManager jobs scheduled after boot")
    }

    companion object {
        private const val TAG = "BootReceiver"
    }
}
