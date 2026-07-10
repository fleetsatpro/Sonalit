package io.sonalit.guardian.ui.panic

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.hilt.navigation.compose.hiltViewModel
import java.io.File
import kotlinx.coroutines.delay

@Composable
fun PanicButtonScreen(
    modifier: Modifier = Modifier,
    viewModel: PanicViewModel = hiltViewModel()
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var isHolding by remember { mutableStateOf(false) }
    var progress by remember { mutableFloatStateOf(0f) }
    val animatedProgress by animateFloatAsState(
        targetValue = if (isHolding) progress else 0f,
        animationSpec = tween(durationMillis = if (isHolding) 3000 else 300),
        label = "panicProgress",
    )

    val vibrator = if (Build.VERSION.SDK_INT >= 31) {
        context.getSystemService(VibratorManager::class.java)?.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }

    // Best-effort only — the panic signal itself (ViewModel.activatePanic) fires
    // unconditionally and never waits on this. If denied, camera/mic capture
    // silently no-ops; the SOS still reaches dispatch.
    val mediaPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions()
    ) { /* no-op: activatePanic already ran regardless of the outcome */ }

    LaunchedEffect(isHolding) {
        if (isHolding) {
            val startTime = System.currentTimeMillis()
            val duration = 3000L
            while (isHolding && System.currentTimeMillis() - startTime < duration) {
                progress = ((System.currentTimeMillis() - startTime).toFloat() / duration).coerceIn(0f, 1f)
                vibrator?.vibrate(VibrationEffect.createOneShot(10, VibrationEffect.DEFAULT_AMPLITUDE))
                delay(200)
            }
            if (isHolding && progress >= 1f) {
                isHolding = false
                if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED ||
                    ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
                ) {
                    mediaPermissionLauncher.launch(arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO))
                }
                viewModel.activatePanic(context)
            }
        } else {
            progress = 0f
        }
    }

    // Runs the front+back photo burst once per activation. CameraX needs a
    // LifecycleOwner to bind to, which only the composable (not the ViewModel) has.
    LaunchedEffect(viewModel.cameraBurstTrigger.value) {
        if (viewModel.cameraBurstTrigger.value == 0) return@LaunchedEffect
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            captureBurst(context, lifecycleOwner)
        }
    }

    Box(contentAlignment = Alignment.Center, modifier = modifier.height(220.dp).fillMaxWidth()) {
        Canvas(modifier = Modifier.size(200.dp)) {
            val canvasSize = size.minDimension
            val strokeWidth = 12.dp.toPx()
            drawCircle(
                color = Color.DarkGray,
                radius = canvasSize / 2 - strokeWidth / 2,
                style = Stroke(width = strokeWidth),
            )
            drawArc(
                color = Color.Red,
                startAngle = -90f,
                sweepAngle = animatedProgress * 360f,
                useCenter = false,
                style = Stroke(width = strokeWidth),
            )
        }

        Button(
            onClick = { /* gesture handles activation, not a plain tap */ },
            modifier = Modifier
                .size(160.dp)
                .pointerInput(Unit) {
                    detectDragGesturesAfterLongPress(
                        onDragStart = { isHolding = true },
                        onDragEnd = { isHolding = false },
                        onDragCancel = { isHolding = false },
                        onDrag = { change, _ -> change.consume() },
                    )
                },
            shape = CircleShape,
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD32F2F)),
        ) {
            Text("HOLD", color = Color.White, style = MaterialTheme.typography.headlineSmall)
        }
    }

    if (viewModel.showCancelDialog.value) {
        PanicCancelDialog(viewModel)
    }

    if (viewModel.panicSendFailed.value) {
        Toast.makeText(context, "Could not reach dispatch — retrying via next connection", Toast.LENGTH_LONG).show()
    }
}

@Composable
fun PanicCancelDialog(viewModel: PanicViewModel) {
    var pin by remember { mutableStateOf("") }
    val context = LocalContext.current
    val error by viewModel.cancelError

    AlertDialog(
        onDismissRequest = { /* cannot dismiss without an explicit choice below */ },
        title = { Text("Panic Activated — Cancel?") },
        text = {
            Column {
                Text("Enter your PIN, or use biometrics, to cancel.")
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(value = pin, onValueChange = { pin = it }, label = { Text("PIN") })
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(error!!, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
                val activity = context as? FragmentActivity
                if (activity != null && BiometricManager.from(context).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS) {
                    Spacer(Modifier.height(8.dp))
                    TextButton(onClick = { authenticateBiometric(activity, viewModel) }) {
                        Text("Use biometrics instead")
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { viewModel.cancelWithPin(pin) }) { Text("Cancel SOS") }
        },
        dismissButton = {
            TextButton(onClick = { viewModel.dismissCancelDialog() }) { Text("Escalate") }
        },
    )
}

private fun authenticateBiometric(activity: FragmentActivity, viewModel: PanicViewModel) {
    val promptInfo = BiometricPrompt.PromptInfo.Builder()
        .setTitle("Cancel Panic")
        .setSubtitle("Authenticate to cancel SOS")
        .setNegativeButtonText("Back")
        .build()
    val prompt = BiometricPrompt(
        activity,
        ContextCompat.getMainExecutor(activity),
        object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                viewModel.onBiometricSuccess()
            }
        },
    )
    prompt.authenticate(promptInfo)
}

/** Captures one back-camera then one front-camera still, sequentially (true concurrent dual-camera
 * capture is only supported on some devices/CameraX versions). Saved to cache dir only — there is
 * no backend endpoint yet to upload panic photos, so this is local evidence, not a dispatch feed. */
private fun captureBurst(context: Context, lifecycleOwner: androidx.lifecycle.LifecycleOwner) {
    val providerFuture = ProcessCameraProvider.getInstance(context)
    providerFuture.addListener({
        val provider = providerFuture.get()
        captureWith(provider, context, lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, "panic_back") {
            captureWith(provider, context, lifecycleOwner, CameraSelector.DEFAULT_FRONT_CAMERA, "panic_front") {
                provider.unbindAll()
            }
        }
    }, ContextCompat.getMainExecutor(context))
}

private fun captureWith(
    provider: ProcessCameraProvider,
    context: Context,
    lifecycleOwner: androidx.lifecycle.LifecycleOwner,
    selector: CameraSelector,
    fileNamePrefix: String,
    onDone: () -> Unit,
) {
    try {
        val imageCapture = ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
            .build()
        provider.unbindAll()
        provider.bindToLifecycle(lifecycleOwner, selector, imageCapture)
        val file = File(context.cacheDir, "${fileNamePrefix}_${System.currentTimeMillis()}.jpg")
        val options = ImageCapture.OutputFileOptions.Builder(file).build()
        imageCapture.takePicture(
            options,
            ContextCompat.getMainExecutor(context),
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                    onDone()
                }
                override fun onError(exc: ImageCaptureException) {
                    Log.e("Panic", "Burst capture failed for $fileNamePrefix", exc)
                    onDone()
                }
            },
        )
    } catch (e: Exception) {
        Log.e("Panic", "Camera bind failed for $fileNamePrefix", e)
        onDone()
    }
}
