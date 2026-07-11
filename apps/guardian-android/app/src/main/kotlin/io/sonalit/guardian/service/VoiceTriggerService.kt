package io.sonalit.guardian.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import dagger.hilt.android.AndroidEntryPoint
import io.sonalit.guardian.R
import io.sonalit.guardian.ui.panic.PanicActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONObject
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import org.vosk.android.StorageService
import javax.inject.Inject

/**
 * Offline (Vosk, no network, nothing ever leaves the device) listener for the
 * distress phrase "PAN PAN PAN" — the maritime/aviation urgency call, chosen
 * so it's distinctive enough not to come up in ordinary conversation while
 * still being sayable hands-free under stress.
 *
 * On recognition: sends the panic API call directly (no activity launch needed)
 * then shows a cancellable "SOS ACTIVE" notification. The user can tap the
 * notification's Cancel action to open PanicActivity and authenticate — this
 * is a user-initiated tap so the activity launch is always allowed.
 *
 * Direct-send avoids Android 10–14 background activity launch restrictions
 * (the foreground-service exception was removed in Android 11, full-screen
 * intent notifications require POST_NOTIFICATIONS on API 33+). The panic is
 * fire-and-forget from the service; cancel is the only thing that needs UI.
 */
@AndroidEntryPoint
class VoiceTriggerService : android.app.Service() {

    @Inject lateinit var panicSender: PanicSender

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var model: Model? = null
    private var speechService: SpeechService? = null
    private var lastTriggerMs = 0L

    private val grammar = """["pan pan pan", "[unk]"]"""

    private val listener = object : RecognitionListener {
        override fun onPartialResult(hypothesis: String?) {}

        override fun onResult(hypothesis: String?) {
            val text = runCatching {
                JSONObject(hypothesis ?: return).optString("text")
            }.getOrNull() ?: return
            if (text.trim().equals("pan pan pan", ignoreCase = true)) {
                triggerPanic()
            }
        }

        override fun onFinalResult(hypothesis: String?) = onResult(hypothesis)

        override fun onError(exception: Exception?) {
            Log.w(TAG, "Recognition error, restarting: ${exception?.message}")
            restartListening()
        }

        override fun onTimeout() = restartListening()
    }

    override fun onCreate() {
        super.onCreate()
        startForegroundNotification()
        LibVosk.setLogLevel(LogLevel.WARNINGS)
        StorageService.unpack(
            this, "model-en-us", "model",
            { unpackedModel ->
                model = unpackedModel
                startListening()
            },
            { exception ->
                Log.e(TAG, "Failed to unpack voice model: ${exception.message}")
                stopSelf()
            },
        )
    }

    private fun startListening() {
        val m = model ?: return
        val recognizer = Recognizer(m, SAMPLE_RATE, grammar)
        speechService = SpeechService(recognizer, SAMPLE_RATE).apply { startListening(listener) }
    }

    private fun restartListening() {
        speechService?.stop()
        speechService = null
        android.os.Handler(mainLooper).postDelayed({ if (model != null) startListening() }, 2000)
    }

    private fun triggerPanic() {
        val now = System.currentTimeMillis()
        if (now - lastTriggerMs < COOLDOWN_MS) return
        lastTriggerMs = now
        Log.w(TAG, "\"PAN PAN PAN\" detected — sending panic")

        // Fire the panic network call directly from the service.  No activity
        // launch needed here — avoids background activity launch restrictions
        // (Android 10+, tightened each release) and the POST_NOTIFICATIONS
        // requirement (API 33+) for full-screen intent notifications.
        serviceScope.launch {
            val ok = panicSender.send(mode = "voice_distress")
            Log.w(TAG, if (ok) "Panic sent OK" else "Panic send FAILED (logged in PanicSender)")
        }

        showSosActiveNotification()
    }

    /**
     * Shows an ongoing "SOS ACTIVE" notification after voice trigger fires.
     * The Cancel action is a user tap, so launching PanicActivity from it is
     * always allowed (user-interaction exception applies).
     */
    private fun showSosActiveNotification() {
        val nm = getSystemService(NotificationManager::class.java)
        val channelId = "voice_sos_active"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(channelId, "SOS Active", NotificationManager.IMPORTANCE_HIGH)
            )
        }

        // PanicActivity opened via user tap — always allowed, no background restriction
        val cancelPi = PendingIntent.getActivity(
            this, 0,
            Intent(this, PanicActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                putExtra(PanicActivity.EXTRA_PANIC_MODE, "voice_distress")
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("SOS ACTIVE — voice distress")
            .setContentText("\"PAN PAN PAN\" detected. Tap to cancel.")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setOngoing(true)
            .addAction(0, "Cancel SOS", cancelPi)
            .setContentIntent(cancelPi)
            .build()
        nm.notify(SOS_NOTIFICATION_ID, notification)
    }

    private fun startForegroundNotification() {
        val channelId = "voice_trigger_service"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(channelId, "Voice Panic Trigger", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("Voice panic trigger active")
            .setContentText("Listening offline for \"PAN PAN PAN\" — audio never leaves this device")
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
        speechService?.stop()
        speechService?.shutdown()
        speechService = null
        model?.close()
        model = null
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val TAG = "VoiceTrigger"
        private const val NOTIFICATION_ID = 2
        private const val SOS_NOTIFICATION_ID = 3
        private const val SAMPLE_RATE = 16000.0f
        private const val COOLDOWN_MS = 10_000L
    }
}
