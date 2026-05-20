package io.sonalit.guardian.worker

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.*
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import io.sonalit.guardian.data.remote.GuardianApi
import io.sonalit.guardian.data.remote.HeartbeatRequest
import java.util.concurrent.TimeUnit

@HiltWorker
class HeartbeatWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val api: GuardianApi,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            val deviceId = inputData.getString(KEY_DEVICE_ID) ?: return Result.failure()
            api.heartbeat(HeartbeatRequest(device_id = deviceId))
            Result.success()
        } catch (e: Exception) {
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }

    companion object {
        const val KEY_DEVICE_ID = "device_id"

        fun schedule(context: Context, deviceId: String) {
            val request = PeriodicWorkRequestBuilder<HeartbeatWorker>(5, TimeUnit.MINUTES)
                .setInputData(workDataOf(KEY_DEVICE_ID to deviceId))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "heartbeat", ExistingPeriodicWorkPolicy.KEEP, request,
            )
        }
    }
}
