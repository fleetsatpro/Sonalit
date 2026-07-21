package io.sonalit.guardian.service

import android.content.Context
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import io.sonalit.guardian.data.remote.GuardianApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File

/**
 * Shared covert single-shot capture + R2 upload, driven from an already-running
 * camera-typed foreground service. Owns a tiny Lifecycle so CameraX's
 * bindToLifecycle has an owner without pulling in lifecycle-service.
 *
 * The caller is responsible for ensuring a foreground service with the camera
 * type is active before invoking — that (not this class) is what grants
 * background camera access on modern Android. This only drives CameraX and the
 * upload, and always invokes [onComplete] so the caller can revert FGS state.
 */
class CameraCaptureController(
    private val context: Context,
    private val api: GuardianApi,
    private val okHttp: OkHttpClient,
) : LifecycleOwner {

    private val registry = LifecycleRegistry(this).apply { currentState = Lifecycle.State.STARTED }
    override val lifecycle: Lifecycle get() = registry
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    fun capture(lens: String, onComplete: () -> Unit) {
        val selector = if (lens == "front") CameraSelector.DEFAULT_FRONT_CAMERA
                       else CameraSelector.DEFAULT_BACK_CAMERA
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            val provider = try {
                future.get()
            } catch (e: Exception) {
                Log.e(TAG, "camera provider unavailable: ${e.message}"); onComplete(); return@addListener
            }
            val imageCapture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .build()
            try {
                provider.unbindAll()
                provider.bindToLifecycle(this, selector, imageCapture)
            } catch (e: Exception) {
                Log.e(TAG, "bindToLifecycle failed: ${e.message}"); onComplete(); return@addListener
            }
            val file = File(context.cacheDir, "capture_${System.currentTimeMillis()}.jpg")
            val opts = ImageCapture.OutputFileOptions.Builder(file).build()
            imageCapture.takePicture(opts, ContextCompat.getMainExecutor(context),
                object : ImageCapture.OnImageSavedCallback {
                    override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                        runCatching { provider.unbindAll() }
                        scope.launch {
                            runCatching { uploadAndReport(file) }
                                .onFailure { Log.e(TAG, "capture upload failed: ${it.message}") }
                            runCatching { file.delete() }
                            onComplete()
                        }
                    }
                    override fun onError(exc: ImageCaptureException) {
                        Log.e(TAG, "takePicture error: ${exc.message}")
                        runCatching { provider.unbindAll() }
                        onComplete()
                    }
                })
        }, ContextCompat.getMainExecutor(context))
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

    companion object { private const val TAG = "CameraCapture" }
}
