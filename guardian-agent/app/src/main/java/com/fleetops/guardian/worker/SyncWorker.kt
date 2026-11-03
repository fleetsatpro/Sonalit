package com.fleetops.guardian.worker

import android.content.Context
import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.*
import com.fleetops.guardian.data.prefs.DevicePrefs
import com.fleetops.guardian.data.repository.GuardianRepository
import com.fleetops.guardian.data.repository.RepositoryResult
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.util.concurrent.TimeUnit

@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted workerParams: WorkerParameters,
    private val repository: GuardianRepository,
    private val devicePrefs: DevicePrefs
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result {
        Log.d(TAG, "SyncWorker starting (run attempt #$runAttemptCount)")

        if (!devicePrefs.isEnrolled()) {
            Log.d(TAG, "Device not enrolled — skipping sync")
            return Result.success()
        }

        return when (val result = repository.syncPendingUploads()) {
            is RepositoryResult.Success -> {
                val count = result.data
                Log.d(TAG, "Sync complete — uploaded $count pending items")
                Result.success(
                    workDataOf(
                        KEY_SYNCED_COUNT to count,
                        KEY_TIMESTAMP to System.currentTimeMillis()
                    )
                )
            }
            is RepositoryResult.Error -> {
                Log.w(TAG, "Sync failed: ${result.message}", result.cause)

                if (runAttemptCount < MAX_RETRIES) {
                    Result.retry()
                } else {
                    Log.e(TAG, "Sync exhausted retries")
                    Result.failure(
                        workDataOf(KEY_ERROR_MESSAGE to result.message)
                    )
                }
            }
        }
    }

    companion object {
        private const val TAG = "SyncWorker"
        private const val MAX_RETRIES = 3

        const val KEY_SYNCED_COUNT = "synced_count"
        const val KEY_TIMESTAMP = "timestamp"
        const val KEY_ERROR_MESSAGE = "error_message"

        /**
         * Builds the periodic sync request (every 5 minutes when network available).
         */
        fun buildPeriodicRequest(): PeriodicWorkRequest {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            return PeriodicWorkRequestBuilder<SyncWorker>(
                repeatInterval = 5L,
                repeatIntervalTimeUnit = TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    WorkRequest.MIN_BACKOFF_MILLIS,
                    TimeUnit.MILLISECONDS
                )
                .addTag(com.fleetops.guardian.GuardianApplication.TAG_SYNC)
                .build()
        }

        /**
         * Builds a one-shot sync request for immediate execution (e.g., on network reconnect).
         */
        fun buildOneTimeRequest(): OneTimeWorkRequest {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            return OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(constraints)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    WorkRequest.MIN_BACKOFF_MILLIS,
                    TimeUnit.MILLISECONDS
                )
                .addTag("${com.fleetops.guardian.GuardianApplication.TAG_SYNC}_onetime")
                .build()
        }
    }
}
