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
import org.json.JSONObject
import org.vosk.LibVosk
import org.vosk.LogLevel
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import org.vosk.android.StorageService

/**
 * Offline (Vosk, no network, nothing ever leaves the device) listener for the
 * distress phrase "PAN PAN PAN" — the maritime/aviation urgency call, chosen
 * so it's distinctive enough not to come up in ordinary conversation while
 * still being sayable hands-free under stress. Detecting it fires the exact
 * same panic path as VolumeKeySOSReceiver: launch PanicActivity, which fires
 * the send() immediately and only then shows the cancel dialog.
 *
 * Opt-in only — started/stopped from Settings (VoiceTriggerViewModel), never
 * runs unless the operator has explicitly turned it on. Requires the model
 * files to be present at app/src/main/assets/model-en-us/ (see README note
 * in that directory) — this is NOT bundled with the source tree; download
 * vosk-model-small-en-us-0.15 from https://alphacephei.com/vosk/models and
 * unzip its contents there before building a release that ships this.
 */
@AndroidEntryPoint
class VoiceTriggerService : android.app.Service() {

    private var model: Model? = null
    private var speechService: SpeechService? = null
    private var lastTriggerMs = 0L

    // The recognizer is constrained to only ever output "pan pan pan" or the
    // catch-all [unk] token — Vosk snaps whatever it hears to the closest of
    // the allowed phrases rather than doing open transcription. This is both
    // far more accurate for a single fixed phrase than open dictation would
    // be, and makes matching trivial (no fuzzy text matching needed below).
    private val grammar = """["pan pan pan", "[unk]"]"""

    private val listener = object : RecognitionListener {
        override fun onPartialResult(hypothesis: String?) { /* acted on final result only, see onResult */ }

        override fun onResult(hypothesis: String?) {
            val text = runCatching { JSONObject(hypothesis ?: return).optString("text") }.getOrNull() ?: return
            if (text.trim().equals("pan pan pan", ignoreCase = true)) {
                triggerPanic()
            }
        }

        override fun onFinalResult(hypothesis: String?) { onResult(hypothesis) }

        override fun onError(exception: Exception?) {
            Log.w(TAG, "Recognition error, restarting listener: ${exception?.message}")
            restartListening()
        }

        override fun onTimeout() { restartListening() }
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
                Log.e(TAG, "Failed to unpack voice model — is assets/model-en-us present? ${exception.message}")
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
        // Small delay avoids a tight crash loop if the mic is unavailable
        // (e.g. another app briefly holding it) rather than erroring instantly again.
        android.os.Handler(mainLooper).postDelayed({ if (model != null) startListening() }, 2000)
    }

    private fun triggerPanic() {
        val now = System.currentTimeMillis()
        if (now - lastTriggerMs < COOLDOWN_MS) return // one panic activation per utterance, not per recognition pass
        lastTriggerMs = now
        Log.w(TAG, "Voice trigger \"PAN PAN PAN\" detected — activating panic")

        val panicIntent = Intent(this, PanicActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra(PanicActivity.EXTRA_PANIC_MODE, "voice_distress")
        }

        // Android 11+ (API 31) removed the foreground-service exception for startActivity(),
        // so a direct call silently drops. Use a full-screen intent notification instead —
        // Android grants these for alarm/call categories regardless of background state.
        val fullScreenPi = PendingIntent.getActivity(
            this, 0, panicIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val nm = getSystemService(NotificationManager::class.java)
        val channelId = "voice_panic_trigger"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(channelId, "Voice Panic", NotificationManager.IMPORTANCE_HIGH)
            )
        }
        val notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("Voice distress trigger")
            .setContentText("\"PAN PAN PAN\" detected — activating SOS")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setFullScreenIntent(fullScreenPi, /* highPriority= */ true)
            .setAutoCancel(true)
            .build()
        nm.notify(PANIC_NOTIFICATION_ID, notification)
    }

    private fun startForegroundNotification() {
        val channelId = "voice_trigger_service"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(channelId, "Voice Panic Trigger", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
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
        private const val PANIC_NOTIFICATION_ID = 3
        private const val SAMPLE_RATE = 16000.0f
        private const val COOLDOWN_MS = 10_000L
    }
}
