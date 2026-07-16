package io.sonalit.guardian.service

import android.app.ActivityManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.core.app.NotificationCompat
import io.sonalit.guardian.BuildConfig
import io.sonalit.guardian.MainActivity
import io.sonalit.guardian.R
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import dagger.hilt.android.qualifiers.ApplicationContext
import io.sonalit.guardian.data.local.DispatchMessageDao
import io.sonalit.guardian.data.local.DispatchMessageEntity
import io.sonalit.guardian.receiver.GuardianDeviceAdminReceiver
import io.sonalit.guardian.worker.SyncWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.UUID
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
    // The app's shared client — its interceptor attaches the X-Device-Token
    // header, which is what authenticates the voice-message audio download.
    private val httpClient: OkHttpClient,
    private val dispatchMessageDao: DispatchMessageDao,
) {
    private val devicePolicyManager by lazy {
        context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    }
    private val adminComponent by lazy { ComponentName(context, GuardianDeviceAdminReceiver::class.java) }

    /** Returns true if the command was actually carried out. */
    suspend fun execute(commandType: String, deviceId: String?, payload: String? = null): Boolean = runCatching {
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
            // Also persisted to the local inbox (Home "Messages from Dispatch")
            // so it's still visible after the notification is dismissed —
            // previously this was fire-and-forget with nothing kept in-app.
            "show_message" -> {
                val text = parseMessageText(payload) ?: return@runCatching false
                showOperatorMessage(text)
                vibrateAlert()
                dispatchMessageDao.insert(
                    DispatchMessageEntity(
                        id = UUID.randomUUID().toString(), kind = "text", text = text,
                        voiceUrl = null, receivedAt = System.currentTimeMillis(),
                    )
                )
                true
            }
            // Dispatch voice recording (Live Fleet "Voice" action).
            // payload: {"voice_id": "...", "url": "https://..."} — download
            // with the device-token client, then play out loud on the alarm
            // stream so it cuts through even when media volume is muted.
            "play_voice_message" -> {
                val url = payload?.let { p -> runCatching { JSONObject(p).optString("url") }.getOrNull() }
                    ?.takeIf { it.isNotBlank() } ?: return@runCatching false
                dispatchMessageDao.insert(
                    DispatchMessageEntity(
                        id = UUID.randomUUID().toString(), kind = "voice", text = null,
                        voiceUrl = url, receivedAt = System.currentTimeMillis(),
                    )
                )
                playVoiceMessage(url)
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

    /** Re-plays a voice message from the Home dispatch inbox (tap-to-play) —
     *  same download/playback path as the original command delivery, just
     *  invoked directly instead of via a command payload. playVoiceMessage()
     *  blocks on network I/O, so unlike execute() (always called from a
     *  background context already) this must move off the caller's thread
     *  itself — a ViewModel's viewModelScope.launch defaults to Main. */
    suspend fun replayVoiceMessage(url: String): Boolean =
        withContext(Dispatchers.IO) { runCatching { playVoiceMessage(url) }.getOrDefault(false) }

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

    /** Downloads the clip (device-token auth via the shared OkHttp client),
     *  plays it on the ALARM stream so it's audible with media volume muted,
     *  and posts a notification + vibration so the officer knows what fired.
     *  Called from Dispatchers.IO in all three command-delivery paths, so the
     *  synchronous download is fine. Returns true once playback starts. */
    private fun playVoiceMessage(url: String): Boolean {
        // Older backends (no BACKEND_URL env) sent a relative path here —
        // Request.Builder().url() throws on those before any request goes
        // out. Resolve against our own API origin instead of failing.
        val absoluteUrl = if (url.startsWith("http")) url else {
            val base = BuildConfig.API_BASE_URL.toHttpUrl()
            val portSuffix = if (base.port != 80 && base.port != 443) ":${base.port}" else ""
            "${base.scheme}://${base.host}$portSuffix$url"
        }
        val cacheFile = File(context.cacheDir, "voice-msg-${absoluteUrl.hashCode()}.bin")
        httpClient.newCall(Request.Builder().url(absoluteUrl).build()).execute().use { resp ->
            if (!resp.isSuccessful) {
                Log.e(TAG, "voice message download failed: HTTP ${resp.code}")
                return false
            }
            resp.body?.byteStream()?.use { input ->
                cacheFile.outputStream().use { output -> input.copyTo(output) }
            } ?: return false
        }

        val player = MediaPlayer().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            setDataSource(cacheFile.absolutePath)
            setOnCompletionListener { mp -> mp.release(); cacheFile.delete() }
            setOnErrorListener { mp, what, extra ->
                Log.e(TAG, "voice message playback error what=$what extra=$extra")
                mp.release(); cacheFile.delete(); true
            }
            prepare()
        }
        showOperatorMessage("Voice message from dispatch — playing now")
        vibrateAlert()
        player.start()
        return true
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

    companion object {
        private const val TAG = "CommandExecutor"

        /** Command payloads must reach execute() as a JSON string. Older
         *  backends returned the payload as a nested object over the poll/
         *  heartbeat paths — Kotlin's Map.toString() ("{url=https://...}")
         *  truncates unquoted values at ':' under lenient JSON parsing, which
         *  is exactly how voice-message URLs became the literal string
         *  "https". Convert maps through JSONObject instead. */
        fun payloadToJson(raw: Any?): String? = when (raw) {
            null -> null
            is String -> raw
            is Map<*, *> -> JSONObject(raw.mapKeys { it.key.toString() }).toString()
            else -> raw.toString()
        }
    }
}
