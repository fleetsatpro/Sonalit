package io.sonalit.guardian.service

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.Observer
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
 *
 * Lifecycle discipline matters here: CameraX keeps every LifecycleOwner it has
 * been bound to in its internal registry and only lets ONE own the camera. A
 * controller that is left alive at STARTED is never evicted, so subsequent
 * captures bind against a repository full of stale owners and every takePicture
 * comes straight back as ERROR_CAMERA_CLOSED. That is why [release] is not
 * optional — the sequence always ends by destroying this owner.
 */
class CameraCaptureController(
    private val context: Context,
    private val api: GuardianApi,
    private val okHttp: OkHttpClient,
) : LifecycleOwner {

    // RESUMED, not STARTED: CameraX treats the resumed owner as the active camera
    // client. A merely-started owner can be pre-empted and closed the instant a
    // capture is requested.
    private val registry = LifecycleRegistry(this).apply { currentState = Lifecycle.State.RESUMED }
    override val lifecycle: Lifecycle get() = registry
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var released = false

    /**
     * Captures from each lens in [lenses] one after another (rear then front by
     * default), driving them off a single controller/lifecycle, and only invokes
     * [onComplete] once the whole sequence is done — after releasing the camera
     * and this owner. Most hardware can't open two cameras at once, so this is
     * sequential rather than parallel.
     */
    fun captureSequence(lenses: List<String>, lat: Double? = null, lng: Double? = null, onComplete: () -> Unit) {
        val queue = ArrayDeque(lenses)
        fun step() {
            val lens = queue.removeFirstOrNull()
            if (lens == null) { release(); onComplete(); return }
            capture(lens, lat, lng) { step() }
        }
        step()
    }

    /**
     * Unbinds and tears this owner down so CameraX evicts it. Idempotent, and
     * safe to call from any thread (lifecycle mutation is posted to main).
     */
    fun release() {
        if (released) return
        released = true
        // DESTROYED is what evicts this owner from CameraX's LifecycleCameraRepository
        // and unbinds its use cases; nothing else is needed.
        val teardown = Runnable { runCatching { registry.currentState = Lifecycle.State.DESTROYED } }
        if (Looper.myLooper() == Looper.getMainLooper()) teardown.run() else main.post(teardown)
    }

    fun capture(lens: String, lat: Double? = null, lng: Double? = null, onComplete: () -> Unit) =
        capture(lens, lat, lng, RETRIES, onComplete)

    private fun capture(lens: String, lat: Double?, lng: Double?, retriesLeft: Int, onComplete: () -> Unit) {
        report("cc_start", "lens=$lens sdk=${Build.VERSION.SDK_INT}")
        val selector = if (lens == "front") CameraSelector.DEFAULT_FRONT_CAMERA
                       else CameraSelector.DEFAULT_BACK_CAMERA
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            val provider = try {
                future.get()
            } catch (e: Exception) {
                Log.e(TAG, "camera provider unavailable: ${e.message}")
                report("cc_provider_fail", e.message ?: ""); onComplete(); return@addListener
            }
            val imageCapture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .build()
            val camera = try {
                provider.unbindAll()
                provider.bindToLifecycle(this, selector, imageCapture)
            } catch (e: Exception) {
                Log.e(TAG, "bindToLifecycle failed: ${e.message}")
                report("cc_bind_fail", "${e.javaClass.simpleName}: ${e.message}"); onComplete(); return@addListener
            }
            // Firing the shutter straight after bindToLifecycle races the camera-open
            // handshake, and CameraX answers an unopened camera with an immediate
            // ERROR_CAMERA_CLOSED. Wait for OPEN (bounded, so a device that never
            // reports it still gets its shot attempted).
            awaitOpen(camera) {
                shoot(provider, imageCapture, lens, lat, lng, retriesLeft, onComplete)
            }
        }, ContextCompat.getMainExecutor(context))
    }

    /** Runs [onReady] on the main thread once the camera reports OPEN, or after [OPEN_TIMEOUT_MS]. */
    private fun awaitOpen(camera: Camera, onReady: () -> Unit) {
        val state = camera.cameraInfo.cameraState
        if (state.value?.type == CameraState.Type.OPEN) { onReady(); return }
        var settled = false
        lateinit var observer: Observer<CameraState>
        val finish = {
            if (!settled) {
                settled = true
                runCatching { state.removeObserver(observer) }
                onReady()
            }
        }
        observer = Observer { s -> if (s.type == CameraState.Type.OPEN) finish() }
        if (!runCatching { state.observeForever(observer) }.isSuccess) { finish(); return }
        main.postDelayed({ finish() }, OPEN_TIMEOUT_MS)
    }

    private fun shoot(
        provider: ProcessCameraProvider,
        imageCapture: ImageCapture,
        lens: String,
        lat: Double?,
        lng: Double?,
        retriesLeft: Int,
        onComplete: () -> Unit,
    ) {
        val file = File(context.cacheDir, "capture_${System.currentTimeMillis()}.jpg")
        val opts = ImageCapture.OutputFileOptions.Builder(file).build()
        imageCapture.takePicture(opts, ContextCompat.getMainExecutor(context),
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                    report("cc_saved", "bytes=${file.length()}")
                    runCatching { provider.unbindAll() }
                    scope.launch {
                        runCatching { uploadAndReport(file, lens, lat, lng) }
                            .onSuccess { report("cc_uploaded", "lens=$lens") }
                            .onFailure { Log.e(TAG, "capture upload failed: ${it.message}"); report("cc_upload_fail", it.message ?: "") }
                        runCatching { file.delete() }
                        onComplete()
                    }
                }
                override fun onError(exc: ImageCaptureException) {
                    Log.e(TAG, "takePicture error: ${exc.message}")
                    runCatching { provider.unbindAll() }
                    // A closed camera is usually transient contention (another app, or a
                    // just-torn-down binding). Rebind from scratch and try once more
                    // rather than losing the shot.
                    if (exc.imageCaptureError == ImageCapture.ERROR_CAMERA_CLOSED && retriesLeft > 0) {
                        report("cc_retry", "code=${exc.imageCaptureError} left=$retriesLeft")
                        main.postDelayed({ capture(lens, lat, lng, retriesLeft - 1, onComplete) }, RETRY_DELAY_MS)
                        return
                    }
                    report("cc_take_error", "code=${exc.imageCaptureError} ${exc.message}")
                    onComplete()
                }
            })
    }

    private fun report(stage: String, detail: String = "") {
        scope.launch { runCatching { api.captureEvent(mapOf("stage" to stage, "detail" to detail)) } }
    }

    private suspend fun uploadAndReport(file: File, lens: String, lat: Double?, lng: Double?) {
        if (!file.exists() || file.length() == 0L) throw IllegalStateException("empty capture file")
        val presign = api.capturePhotoUrl()
        val put = Request.Builder()
            .url(presign.upload_url)
            .put(file.asRequestBody("image/jpeg".toMediaType()))
            .build()
        okHttp.newCall(put).execute().use { resp ->
            if (!resp.isSuccessful) error("R2 PUT failed: ${resp.code}")
        }
        // "front"/"back" so dispatch can tell the selfie frame from the scene one.
        val camera = if (lens == "front") "front" else "back"
        val body = buildMap {
            put("public_url", presign.public_url)
            put("key", presign.key)
            put("camera", camera)
            if (lat != null && lng != null) { put("lat", lat.toString()); put("lng", lng.toString()) }
        }
        api.capturePhoto(body)
    }

    companion object {
        private const val TAG = "CameraCapture"
        private const val RETRIES = 1
        private const val RETRY_DELAY_MS = 700L
        private const val OPEN_TIMEOUT_MS = 3500L
    }
}
