package com.fleetops.guardian

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.*
import com.fleetops.guardian.worker.HeartbeatWorker
import com.fleetops.guardian.worker.SyncWorker
import dagger.hilt.android.HiltAndroidApp
import java.util.concurrent.TimeUnit
import javax.inject.Inject

@HiltAndroidApp
class GuardianApplication : Application(), Configuration.Provider {

    @Inject
    lateinit var workerFactory: HiltWorkerFactory

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
        schedulePeriodicWork()
    }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .setMinimumLoggingLevel(android.util.Log.INFO)
            .build()

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager =
                getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            // Guardian service persistent channel
            NotificationChannel(
                CHANNEL_GUARDIAN_SERVICE,
                "Guardian Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Persistent notification for the Guardian tracking service"
                setShowBadge(false)
                notificationManager.createNotificationChannel(this)
            }

            // Alerts channel (panic, commands, etc.)
            NotificationChannel(
                CHANNEL_ALERTS,
                "Fleet Alerts",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "High-priority alerts from fleet command"
                enableVibration(true)
                notificationManager.createNotificationChannel(this)
            }

            // Command channel (push messages from server)
            NotificationChannel(
                CHANNEL_COMMANDS,
                "Fleet Commands",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Commands and messages from fleet command"
                notificationManager.createNotificationChannel(this)
            }
        }
    }

    private fun schedulePeriodicWork() {
        val workManager = WorkManager.getInstance(this)

        // HeartbeatWorker — every 60 seconds with network constraint
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
            .addTag(TAG_HEARTBEAT)
            .build()

        workManager.enqueueUniquePeriodicWork(
            WORK_HEARTBEAT,
            ExistingPeriodicWorkPolicy.KEEP,
            heartbeatRequest
        )

        // SyncWorker — every 5 minutes, also runs when network reconnects
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
            .addTag(TAG_SYNC)
            .build()

        workManager.enqueueUniquePeriodicWork(
            WORK_SYNC,
            ExistingPeriodicWorkPolicy.KEEP,
            syncRequest
        )
    }

    companion object {
        const val CHANNEL_GUARDIAN_SERVICE = "guardian_service"
        const val CHANNEL_ALERTS = "fleet_alerts"
        const val CHANNEL_COMMANDS = "fleet_commands"

        const val WORK_HEARTBEAT = "guardian_heartbeat"
        const val WORK_SYNC = "guardian_sync"

        const val TAG_HEARTBEAT = "heartbeat"
        const val TAG_SYNC = "sync"

        const val NOTIFICATION_ID_SERVICE = 1001
        const val NOTIFICATION_ID_ALERT = 1002
        const val NOTIFICATION_ID_COMMAND = 1003
    }
}
