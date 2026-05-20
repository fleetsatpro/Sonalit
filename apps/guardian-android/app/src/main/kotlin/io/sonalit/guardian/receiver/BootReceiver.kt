package io.sonalit.guardian.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.WorkManager
import io.sonalit.guardian.service.GuardianService
import io.sonalit.guardian.worker.HeartbeatWorker

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        context.startForegroundService(Intent(context, GuardianService::class.java))
        HeartbeatWorker.schedule(context, deviceId = "")
    }
}
