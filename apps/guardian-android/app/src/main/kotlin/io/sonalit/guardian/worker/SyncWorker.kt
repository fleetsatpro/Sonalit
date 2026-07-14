package io.sonalit.guardian.worker

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.*
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import io.sonalit.guardian.data.local.AppDatabase
import io.sonalit.guardian.data.local.SyncStatusStore
import io.sonalit.guardian.data.remote.GuardianApi
import io.sonalit.guardian.data.remote.LocationBatchRequest
import io.sonalit.guardian.data.remote.LocationPoint
import java.time.Instant
import java.util.concurrent.TimeUnit

@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val db: AppDatabase,
    private val api: GuardianApi,
    private val syncStatusStore: SyncStatusStore,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            val fixes = db.gpsFixDao().getUnsynced(limit = 50)
            if (fixes.isEmpty()) {
                // Nothing queued means the sync pipeline itself is caught up and
                // reachable, not that it's broken — record it so HomeScreen's
                // "GPS" status doesn't read stale just because the officer hasn't
                // moved in a while.
                syncStatusStore.recordSuccess()
                return Result.success()
            }
            val batch = LocationBatchRequest(
                points = fixes.map {
                    LocationPoint(
                        lat = it.lat,
                        lon = it.lon,
                        heading = it.heading,
                        speed = it.speed * 3.6f,
                        accuracyM = it.accuracy,
                        timestamp = Instant.ofEpochMilli(it.ts).toString(),
                    )
                },
            )
            api.locationBatch(batch)
            db.gpsFixDao().markSynced(fixes.map { it.id })
            syncStatusStore.recordSuccess()
            Result.success()
        } catch (e: Exception) {
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }

    companion object {
        /**
         * SyncWorker previously had no periodic schedule at all — it only ever
         * ran as a one-time job in response to a remote force_sync/
         * request_location/force_checkin command (CommandExecutor). Every fix
         * GuardianService buffered locally piled up in Room forever unless
         * dispatch happened to send one of those commands to this specific
         * device. 10 minutes mirrors the same "allow one missed cycle" slack
         * as HeartbeatWorker's 5-minute period.
         */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(10, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "gps-sync", ExistingPeriodicWorkPolicy.KEEP, request,
            )
        }
    }
}
