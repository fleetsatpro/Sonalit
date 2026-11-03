package com.fleetops.guardian.worker

import android.content.Context
import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.*
import com.fleetops.guardian.data.prefs.DevicePrefs
import com.fleetops.guardian.data.repository.GuardianRepository
import com.fleetops.guardian.data.repository.RepositoryResult
import com.fleetops.guardian.service.GuardianService
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.util.concurrent.TimeUnit

@HiltWorker
class HeartbeatWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted workerParams: WorkerParameters,
    private val repository: GuardianRepository,
    private val devicePrefs: DevicePrefs
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result {
        Log.d(TAG, "HeartbeatWorker starting (run attempt #$runAttemptCount)")

        // Skip if not enrolled
        if (!devicePrefs.isEnrolled()) {
            Log.d(TAG, "Device not enrolled — skipping heartbeat")
            return Result.success()
        }

        return when (val result = repository.sendHeartbeat()) {
            is RepositoryResult.Success -> {
                Log.d(TAG, "Heartbeat success: status=${result.data.status}")
                // If commands arrived, ensure the service is running to drain the channel
                if (result.data.commands?.isNotEmpty() == true) {
                    GuardianService.startService(applicationContext)
                }
                Result.success(
                    workDataOf(
                        KEY_HEARTBEAT_STATUS to result.data.status,
                        KEY_TIMESTAMP to System.currentTimeMillis()
                    )
                )
            }
            is RepositoryResult.Error -> {
                Log.w(TAG, "Heartbeat failed: ${result.message}", result.cause)

                if (runAttemptCount < MAX_RETRIES) {
                    Result.retry()
                } else {
                    // Give up for this cycle — will try again on next periodic trigger
                    Log.e(TAG, "Heartbeat exhausted retries after $runAttemptCount attempts")
                    Result.failure(
                        workDataOf(KEY_ERROR_MESSAGE to result.message)
                    )
                }
            }
        }
    }

    companion object {
        private const val TAG = "HeartbeatWorker"
        private const val MAX_RETRIES = 3

        const val KEY_HEARTBEAT_STATUS = "heartbeat_status"
        const val KEY_TIMESTAMP = "timestamp"
        const val KEY_ERROR_MESSAGE = "error_message"

        fun buildPeriodicRequest(): PeriodicWorkRequest {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            return PeriodicWorkRequestBuilder<HeartbeatWorker>(
                repeatInterval = 60L,
                repeatIntervalTimeUnit = TimeUnit.SECONDS
            )
                .setConstraints(constraints)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    WorkRequest.MIN_BACKOFF_MILLIS,
                    TimeUnit.MILLISECONDS
                )
                .addTag(com.fleetops.guardian.GuardianApplication.TAG_HEARTBEAT)
                .build()
        }
    }
}
