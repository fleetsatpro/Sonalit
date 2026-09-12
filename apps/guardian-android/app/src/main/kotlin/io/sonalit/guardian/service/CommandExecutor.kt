package io.sonalit.guardian.service

import android.Manifest
import android.app.ActivityManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.Looper
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
import io.sonalit.guardian.ui.capture.CaptureRequestActivity
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
            "trigger_siren" -> { triggerSiren(parseSirenDuration(payload)); true }
            // Covert "remote eyes" capture. Fully silent on modern Android needs
            // the camera reached from an *already-running* FGS (a fresh camera-FGS
            // start is blocked in the background on Android 14+). So we hand it to
            // the persistent GuardianService, which promotes itself to the camera
            // type for the shot. That needs CAMERA held — a device-owner install
            // grants it silently below. Without it we fall back to the standalone
            // service and finally a tap-to-capture request the officer completes.
            "capture_photo" -> {
                val lens = payload?.let { p -> runCatching { JSONObject(p).optString("camera") }.getOrNull() }
                    ?.takeIf { it.isNotBlank() } ?: "back"

                val isDeviceOwner = runCatching {
                    devicePolicyManager.isDeviceOwnerApp(context.packageName)
                }.getOrDefault(false)

                // Device owner? grant CAMERA silently so the covert path needs no prompt.
                if (isDeviceOwner) runCatching {
                    devicePolicyManager.setPermissionGrantState(
                        adminComponent, context.packageName, Manifest.permission.CAMERA,
                        DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED,
                    )
                }

                val hasCamera = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                    PackageManager.PERMISSION_GRANTED

                // Silent covert capture works whenever the OS lets us drive the
                // camera from an already-running foreground service in the
                // background. That's true up to Android 13 (promoting the running
                // FGS to add the camera type is not a new background start, and the
                // FGS "while-in-use" type restriction that blocks it only arrived
                // in Android 14). On Android 14+ only a Device Owner install is
                // exempt; otherwise the OS hard-blocks background camera and the
                // shot would silently no-op — so, and only then, drop to the
                // tap-to-capture prompt as the last resort.
                val canSilent = hasCamera &&
                    (isDeviceOwner || Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE)

                val delivered = canSilent && runCatching {
                    // Deliver into the running GuardianService (an existing FGS can
                    // touch the camera without a blocked background start).
                    val toService = Intent(context, GuardianService::class.java)
                        .setAction(GuardianService.ACTION_CAPTURE_PHOTO)
                        .putExtra(GuardianService.EXTRA_LENS, lens)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(toService)
                    else context.startService(toService)
                }.isSuccess

                if (!delivered) startCaptureFallback(lens)
                true
            }
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
            "stop_siren" -> { stopSiren(); true }
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

    /** Non-silent fallback path: try the standalone camera FGS (works pre-Android
     *  12, or inside an FCM start window), and if even that is denied, drop to a
     *  tap-to-capture notification the officer completes on screen. */
    private fun startCaptureFallback(lens: String) {
        // Pre-Android-12 a standalone background camera FGS still works. On 12+
        // the OS blocks it — startForegroundService "succeeds" but the service
        // can't promote to the camera type and the shot no-ops — so don't trust
        // that start; go straight to the tap-to-capture prompt the officer
        // completes in the foreground.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            val intent = Intent(context, PhotoCaptureService::class.java)
                .putExtra(PhotoCaptureService.EXTRA_LENS, lens)
            if (runCatching { context.startForegroundService(intent) }.isSuccess) return
        }
        postCaptureRequestNotification()
    }

    /** Fallback for capture_photo when the covert service can't start: a
     *  high-priority notification the officer taps to capture on screen. */
    private fun postCaptureRequestNotification() {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel("capture_request", "Dispatch Requests", NotificationManager.IMPORTANCE_HIGH)
            )
        }
        val contentIntent = PendingIntent.getActivity(
            context, 0,
            Intent(context, CaptureRequestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, "capture_request")
            .setContentTitle("Dispatch requested a photo")
            .setContentText("Tap to capture and send")
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .build()
        nm.notify("capture-request".hashCode(), notification)
    }

    // ── Audible siren ────────────────────────────────────────────────────────
    // The old (guardian-agent) app played a looping alarm tone on the ALARM
    // stream at max volume; the Compose rewrite reduced trigger_siren to a
    // vibrate only, so a dispatcher-triggered "siren" made no sound at all.
    // Restore the audible behaviour, reusing the same ALARM-stream MediaPlayer
    // approach already used by playVoiceMessage() above. Held at class scope
    // (this is a @Singleton) so stop_siren and the auto-stop timer can end it;
    // @Synchronized guards the shared player against the several threads that
    // can drive execute() (FCM service, HeartbeatWorker).
    private var sirenPlayer: MediaPlayer? = null
    private val sirenHandler = Handler(Looper.getMainLooper())
    private var sirenStopCallback: Runnable? = null

    /** Optional {"duration_seconds": N} in the command payload; defaults to 30. */
    private fun parseSirenDuration(payload: String?): Int {
        if (payload.isNullOrBlank()) return DEFAULT_SIREN_SECONDS
        return runCatching {
            val n = JSONObject(payload).optInt("duration_seconds", DEFAULT_SIREN_SECONDS)
            n.coerceIn(1, MAX_SIREN_SECONDS)
        }.getOrDefault(DEFAULT_SIREN_SECONDS)
    }

    @Synchronized
    private fun triggerSiren(durationSeconds: Int) {
        try {
            // Best-effort max alarm volume; ignore if the OS/device denies it.
            runCatching {
                val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                am.setStreamVolume(
                    AudioManager.STREAM_ALARM,
                    am.getStreamMaxVolume(AudioManager.STREAM_ALARM),
                    0,
                )
            }.onFailure { Log.w(TAG, "Could not set alarm volume: ${it.message}") }

            val alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                ?: run {
                    Log.e(TAG, "No alarm/ringtone URI available — vibrating only")
                    vibrateAlert()
                    return
                }

            stopSirenInternal() // clear any siren already running
            sirenPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setDataSource(context, alarmUri)
                isLooping = true
                setOnErrorListener { mp, what, extra ->
                    Log.e(TAG, "siren playback error what=$what extra=$extra")
                    mp.release(); if (sirenPlayer === mp) sirenPlayer = null; true
                }
                prepare()
                start()
            }
            vibrateAlert()

            // Auto-stop after the requested window (no lifecycleScope here).
            sirenStopCallback = Runnable { stopSiren() }
            sirenHandler.postDelayed(sirenStopCallback!!, durationSeconds.toLong() * 1000)
            Log.i(TAG, "Siren triggered for ${durationSeconds}s")
        } catch (e: Exception) {
            Log.e(TAG, "Siren failed: ${e.message}")
            vibrateAlert() // fall back to at least vibrating
        }
    }

    @Synchronized
    private fun stopSiren() {
        stopSirenInternal()
        stopVibrate()
    }

    private fun stopSirenInternal() {
        sirenStopCallback?.let { sirenHandler.removeCallbacks(it) }
        sirenStopCallback = null
        sirenPlayer?.apply { runCatching { if (isPlaying) stop() }; release() }
        sirenPlayer = null
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
        private const val DEFAULT_SIREN_SECONDS = 30
        private const val MAX_SIREN_SECONDS = 300

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
