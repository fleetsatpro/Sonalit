package io.sonalit.guardian.worker

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import androidx.hilt.work.HiltWorker
import androidx.work.*
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import io.sonalit.guardian.data.local.HeartbeatStatusStore
import io.sonalit.guardian.data.remote.GuardianApi
import io.sonalit.guardian.data.remote.HeartbeatRequest
import io.sonalit.guardian.service.CommandExecutor
import java.util.concurrent.TimeUnit

@HiltWorker
class HeartbeatWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val api: GuardianApi,
    private val commandExecutor: CommandExecutor,
    private val statusStore: HeartbeatStatusStore,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        return try {
            val deviceId = inputData.getString(KEY_DEVICE_ID) ?: return Result.failure()
            val response = api.heartbeat(HeartbeatRequest(
                device_id = deviceId,
                battery_pct = readBatteryPct(),
                connectivity = readConnectivity(),
            ))
            statusStore.recordSuccess()
            // Fallback delivery path for commands FCM couldn't wake the device for —
            // the heartbeat only ever hands back commands it just marked 'sent', so
            // this is the one chance to execute+ack them if the push never arrived.
            for (cmd in response.commands) {
                val commandId = (cmd["id"] ?: cmd["command_id"])?.toString() ?: continue
                val commandType = cmd["command_type"]?.toString() ?: continue
                val success = commandExecutor.execute(commandType, deviceId)
                runCatching {
                    api.ackCommand(mapOf("command_id" to commandId, "status" to if (success) "executed" else "failed"))
                }
            }
            Result.success()
        } catch (e: Exception) {
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }

    private fun readBatteryPct(): Int? = runCatching {
        val bm = applicationContext.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    }.getOrNull()?.takeIf { it in 0..100 }

    private fun readConnectivity(): String? = runCatching {
        val cm = applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return@runCatching null
        when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            else -> "other"
        }
    }.getOrNull()

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
