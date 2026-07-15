package io.sonalit.guardian.service

import android.app.ActivityManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import io.sonalit.guardian.MainActivity
import io.sonalit.guardian.R
import org.json.JSONObject
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import dagger.hilt.android.qualifiers.ApplicationContext
import io.sonalit.guardian.receiver.GuardianDeviceAdminReceiver
import io.sonalit.guardian.worker.SyncWorker
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Carries out a device_commands row's command_type on this device. Shared by
 * GuardianFirebaseMessagingService (the primary, works-in-background path) and
 * HeartbeatWorker (fallback for commands missed while FCM couldn't reach the
 * device) so both ack with a status that reflects what actually happened,
 * instead of rubber-stamping "executed" without doing anything.
 */
@Singleton
class CommandExecutor @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val devicePolicyManager by lazy {
        context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    }
    private val adminComponent by lazy { ComponentName(context, GuardianDeviceAdminReceiver::class.java) }

    /** Returns true if the command was actually carried out. */
    fun execute(commandType: String, deviceId: String?, payload: String? = null): Boolean = runCatching {
        when (commandType) {
            "request_location", "force_checkin", "force_sync" -> {
                if (deviceId == null) return@runCatching false
                val work = OneTimeWorkRequestBuilder<SyncWorker>()
                    .setInputData(workDataOf("device_id" to deviceId))
                    .build()
                WorkManager.getInstance(context).enqueue(work)
                true
            }
            "lock_screen", "LOCKDOWN" -> {
                if (!devicePolicyManager.isAdminActive(adminComponent)) return@runCatching false
                devicePolicyManager.lockNow()
                true
            }
            "trigger_siren" -> { vibrateAlert(); true }
            // Operator text from the dashboard (Live Fleet "Msg" action).
            // payload: {"text": "..."} — shown as a high-priority notification
            // plus the alert vibration so it lands even with the screen off.
            "show_message" -> {
                val text = parseMessageText(payload) ?: return@runCatching false
                showOperatorMessage(text)
                vibrateAlert()
                true
            }
            "stop_siren" -> { stopVibrate(); true }
            "restart_app", "restart_agent" -> { restartGuardianService(); true }
            "clear_app_data" -> {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return@runCatching false
                val am = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
                am.clearApplicationUserData()
                true
            }
            "remote_wipe", "WIPE" -> {
                if (!devicePolicyManager.isAdminActive(adminComponent)) return@runCatching false
                devicePolicyManager.wipeData(0)
                true
            }
            else -> false
        }
    }.getOrDefault(false)

    /** payload may be the raw JSON object string or (from the heartbeat map)
     *  a Kotlin map .toString() — try JSON first, fall back to the raw text. */
    private fun parseMessageText(payload: String?): String? {
        if (payload.isNullOrBlank()) return null
        runCatching {
            val text = JSONObject(payload).optString("text")
            if (text.isNotBlank()) return text
        }
        return payload.takeIf { it.isNotBlank() && !it.startsWith("{") }
    }

    private fun showOperatorMessage(text: String) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel("operator_messages", "Dispatch Messages", NotificationManager.IMPORTANCE_HIGH)
            )
        }
        val contentIntent = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, "operator_messages")
            .setContentTitle("Message from dispatch")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .build()
        nm.notify(("op-msg" + System.currentTimeMillis()).hashCode(), notification)
    }

    private fun vibrateAlert() {
        val pattern = longArrayOf(0, 400, 200, 400, 200, 400, 200, 400)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vm.defaultVibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
        } else {
            @Suppress("DEPRECATION")
            val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
        }
    }

    private fun stopVibrate() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vm.defaultVibrator.cancel()
        } else {
            @Suppress("DEPRECATION")
            (context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator).cancel()
        }
    }

    private fun restartGuardianService() {
        val intent = Intent(context, GuardianService::class.java).apply {
            action = "io.sonalit.guardian.ACTION_START_SERVICE"
        }
        context.stopService(intent)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
    }
}
