package io.sonalit.guardian.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import io.sonalit.guardian.service.GuardianService
import io.sonalit.guardian.worker.HeartbeatWorker
import io.sonalit.guardian.worker.SyncWorker

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != "android.intent.action.LOCKED_BOOT_COMPLETED" &&
            action != "android.intent.action.MY_PACKAGE_REPLACED"
        ) return

        val prefs = openPrefs(context) ?: return
        val deviceId = prefs.getString("device_id", null) ?: return
        context.startForegroundService(Intent(context, GuardianService::class.java))
        HeartbeatWorker.schedule(context, deviceId = deviceId)
        SyncWorker.schedule(context)
    }

    private fun openPrefs(context: Context): android.content.SharedPreferences? {
        return try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context,
                "guardian_prefs",
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        } catch (_: Exception) {
            null
        }
    }
}
