package io.sonalit.guardian.worker

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.*
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import io.sonalit.guardian.data.local.AppDatabase
import io.sonalit.guardian.data.remote.GuardianApi
import io.sonalit.guardian.data.remote.TelemetryBatch
import io.sonalit.guardian.data.remote.GpsFixDto

@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val db: AppDatabase,
    private val api: GuardianApi,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            val deviceId = inputData.getString("device_id") ?: return Result.failure()
            val fixes = db.gpsFixDao().getUnsynced(limit = 50)
            if (fixes.isEmpty()) return Result.success()
            val batch = TelemetryBatch(
                device_id = deviceId,
                fixes = fixes.map { GpsFixDto(lat = it.lat, lon = it.lon, speed_kmh = it.speed * 3.6f, heading = it.heading, accuracy_m = it.accuracy, ts = it.ts) },
            )
            api.telemetryBatch(batch)
            db.gpsFixDao().markSynced(fixes.map { it.id })
            Result.success()
        } catch (e: Exception) {
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }
}
