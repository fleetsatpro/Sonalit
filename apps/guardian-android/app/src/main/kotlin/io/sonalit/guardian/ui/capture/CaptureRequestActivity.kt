package io.sonalit.guardian.ui.capture

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import dagger.hilt.android.AndroidEntryPoint
import io.sonalit.guardian.ui.cfo.CameraCapture
import io.sonalit.guardian.ui.theme.GuardianTheme

/**
 * Officer-tap fallback for a capture_photo command: opened from the notification
 * CommandExecutor posts when the covert PhotoCaptureService can't run. Shows the
 * camera; the officer taps the shutter, and the shot uploads via the same
 * capture pipeline. Shows over the lockscreen (like PanicActivity) so a request
 * is actionable without unlocking.
 */
@AndroidEntryPoint
class CaptureRequestActivity : ComponentActivity() {

    private val vm: CaptureRequestViewModel by viewModels()

    @OptIn(ExperimentalPermissionsApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        setContent {
            GuardianTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    val state by vm.state.collectAsState()
                    val camPerm = rememberPermissionState(Manifest.permission.CAMERA)

                    LaunchedEffect(Unit) {
                        if (!camPerm.status.isGranted) camPerm.launchPermissionRequest()
                    }
                    LaunchedEffect(state) {
                        if (state == CaptureRequestViewModel.State.DONE ||
                            state == CaptureRequestViewModel.State.ERROR
                        ) finish()
                    }

                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        when {
                            state == CaptureRequestViewModel.State.UPLOADING -> CircularProgressIndicator()
                            camPerm.status.isGranted -> CameraCapture(
                                onImageCaptured = { file -> vm.upload(file) },
                                modifier = Modifier.fillMaxSize(),
                            )
                            else -> Text(
                                "Camera permission is required to send the requested photo.",
                                modifier = Modifier.padding(24.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}
