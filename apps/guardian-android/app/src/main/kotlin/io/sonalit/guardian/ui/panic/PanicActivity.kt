package io.sonalit.guardian.ui.panic

import android.os.Build
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.fragment.app.FragmentActivity
import dagger.hilt.android.AndroidEntryPoint
import io.sonalit.guardian.ui.theme.GuardianTheme

/**
 * Launched by VolumeKeySOSReceiver (and can be launched directly for any other
 * hardware/external trigger). Skips the in-app hold-to-arm gesture entirely —
 * the trigger that opened this activity already *is* the confirmation — fires
 * the real SOS immediately, and shows only the cancel dialog. FragmentActivity
 * (not plain ComponentActivity) because BiometricPrompt requires one.
 */
@AndroidEntryPoint
class PanicActivity : FragmentActivity() {

    companion object {
        /** Optional String extra — one of PanicSender's backend-recognized modes.
         *  Defaults to "silent" when absent (the plain hardware-trigger case). */
        const val EXTRA_PANIC_MODE = "panic_mode"
    }

    private val viewModel: PanicViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        setContent {
            GuardianTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    val showDialog by viewModel.showCancelDialog
                    var everShown by remember { mutableStateOf(false) }

                    val panicMode = intent.getStringExtra(EXTRA_PANIC_MODE) ?: "silent"
                    LaunchedEffect(Unit) { viewModel.activatePanic(this@PanicActivity, mode = panicMode) }
                    LaunchedEffect(showDialog) {
                        if (showDialog) everShown = true
                        if (everShown && !showDialog) finish()
                    }

                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("SOS ACTIVATED", style = MaterialTheme.typography.headlineMedium)
                    }
                    if (showDialog) {
                        PanicCancelDialog(viewModel)
                    }
                }
            }
        }
    }
}
