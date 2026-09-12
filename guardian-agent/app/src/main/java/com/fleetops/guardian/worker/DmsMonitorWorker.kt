package com.fleetops.guardian.worker

import android.content.Context
import android.util.Log
import androidx.hilt.work.HiltWorker
import androidx.work.*
import com.fleetops.guardian.service.DeadMansSwitchManager
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject

@HiltWorker
class DmsMonitorWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted workerParams: WorkerParameters,
    private val dmsManager: DeadMansSwitchManager,
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result {
        return try {
            val triggered = dmsManager.evaluateTimeout()
            Log.d(TAG, "DMS check complete — triggered=$triggered")
            Result.success(workDataOf(KEY_TRIGGERED to triggered))
        } catch (e: Exception) {
            Log.e(TAG, "DMS check error", e)
            if (runAttemptCount < MAX_RETRIES) Result.retry() else Result.failure()
        }
    }

    companion object {
        private const val TAG = "DmsMonitorWorker"
        private const val MAX_RETRIES = 2
        const val KEY_TRIGGERED = "triggered"
    }
}
