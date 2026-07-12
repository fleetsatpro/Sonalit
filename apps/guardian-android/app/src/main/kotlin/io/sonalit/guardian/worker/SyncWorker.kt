package io.sonalit.guardian.worker

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.*
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import io.sonalit.guardian.data.local.AppDatabase
import io.sonalit.guardian.data.remote.GuardianApi
import io.sonalit.guardian.data.remote.LocationBatchRequest
import io.sonalit.guardian.data.remote.LocationPoint
import java.time.Instant

@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val db: AppDatabase,
    private val api: GuardianApi,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            val fixes = db.gpsFixDao().getUnsynced(limit = 50)
            if (fixes.isEmpty()) return Result.success()
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
            Result.success()
        } catch (e: Exception) {
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }
}
