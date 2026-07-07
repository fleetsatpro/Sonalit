package io.sonalit.guardian.ui.cfo

import android.Manifest
import android.content.Context
import android.location.Location
import android.util.Log
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.rememberMultiplePermissionsState
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import java.io.File
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

// ── SOD/EOD Upload Screen ─────────────────────────────────────────────────────

@OptIn(ExperimentalPermissionsApi::class)
@Composable
fun CfoSodEodScreen(viewModel: CfoViewModel) {
    val state by viewModel.state.collectAsState()
    val session = if (state.screen == CfoNavScreen.SOD) "sod" else "eod"
    val sessionLabel = if (session == "sod") "Start of Day" else "End of Day"
    val ctx = state.context

    val permsState = rememberMultiplePermissionsState(
        listOf(Manifest.permission.CAMERA, Manifest.permission.ACCESS_FINE_LOCATION)
    )

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
    ) {
        // Top bar
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { viewModel.navigate(CfoNavScreen.DASHBOARD) }) {
                Icon(Icons.Default.ArrowBack, contentDescription = "Back")
            }
            Text("$sessionLabel Photos", style = MaterialTheme.typography.headlineSmall)
        }
        Spacer(Modifier.height(12.dp))

        if (ctx == null) {
            Text("No convoy context loaded.", color = MaterialTheme.colorScheme.error)
            return@Column
        }

        if (!permsState.allPermissionsGranted) {
            PermissionRequest(
                message = "Camera and location access are required to capture and geo-stamp photos.",
                onRequest = { permsState.launchMultiplePermissionRequest() },
            )
            return@Column
        }

        // Truck selector
        var selectedTruckId by remember { mutableStateOf(
            state.selectedTruckId ?: ctx.assigned_trucks.firstOrNull()?.id ?: ""
        ) }
        var photoType by remember { mutableStateOf("front") }
        var sealPosition by remember { mutableStateOf("") }
        var capturedFile by remember { mutableStateOf<File?>(null) }
        var lastLocation by remember { mutableStateOf<Location?>(null) }

        val context = LocalContext.current

        // Capture last known location
        LaunchedEffect(Unit) {
            lastLocation = getLastKnownLocation(context)
        }

        Text("Select Truck", style = MaterialTheme.typography.labelLarge)
        Spacer(Modifier.height(6.dp))
        ctx.assigned_trucks.forEach { truck ->
            FilterChip(
                selected = selectedTruckId == truck.id,
                onClick = { selectedTruckId = truck.id },
                label = { Text(truck.plate_number) },
                modifier = Modifier.padding(end = 4.dp),
            )
        }
        Spacer(Modifier.height(12.dp))

        // Photo type
        Text("Photo Type", style = MaterialTheme.typography.labelLarge)
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("front", "rear", "seal").forEach { type ->
                FilterChip(
                    selected = photoType == type,
                    onClick = { photoType = type },
                    label = { Text(type.replaceFirstChar { it.uppercase() }) },
                )
            }
        }
        if (photoType == "seal") {
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = sealPosition,
                onValueChange = { sealPosition = it },
                label = { Text("Seal Position (e.g. 1, 2, front-left)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Spacer(Modifier.height(12.dp))

        // Camera / preview
        if (capturedFile == null) {
            CameraCapture(
                onImageCaptured = { capturedFile = it },
                modifier = Modifier.fillMaxWidth().aspectRatio(4f / 3f),
            )
        } else {
            Card(modifier = Modifier.fillMaxWidth().aspectRatio(4f / 3f)) {
                Box(contentAlignment = Alignment.Center) {
                    AsyncImage(
                        model = capturedFile,
                        contentDescription = "Captured photo",
                        modifier = Modifier.fillMaxSize(),
                    )
                    Row(
                        modifier = Modifier.align(Alignment.BottomEnd).padding(8.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        SmallFloatingActionButton(onClick = { capturedFile = null }) {
                            Icon(Icons.Default.Refresh, contentDescription = "Retake")
                        }
                    }
                }
            }
        }

        // GPS indicator
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                if (lastLocation != null) Icons.Default.GpsFixed else Icons.Default.GpsOff,
                contentDescription = null,
                modifier = Modifier.size(14.dp),
                tint = if (lastLocation != null) MaterialTheme.colorScheme.primary
                       else MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.width(4.dp))
            Text(
                if (lastLocation != null)
                    "GPS: ${String.format("%.5f", lastLocation!!.latitude)}, ${String.format("%.5f", lastLocation!!.longitude)}"
                else "GPS not available",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Spacer(Modifier.height(16.dp))

        // Upload button
        val alreadyUploading = state.uploads.any { u ->
            u.truckId == selectedTruckId && u.session == session &&
            u.photoType == photoType && u.sealPosition == sealPosition.ifBlank { null } &&
            u.status == UploadStatus.UPLOADING
        }
        Button(
            onClick = {
                capturedFile?.let { file ->
                    viewModel.uploadPhoto(
                        file = file,
                        truckId = selectedTruckId,
                        session = session,
                        photoType = photoType,
                        sealPosition = sealPosition.ifBlank { null },
                        location = lastLocation,
                    )
                    capturedFile = null
                }
            },
            enabled = capturedFile != null && !alreadyUploading &&
                (photoType != "seal" || sealPosition.isNotBlank()),
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (alreadyUploading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            else { Icon(Icons.Default.CloudUpload, contentDescription = null); Spacer(Modifier.width(6.dp)); Text("Upload Photo") }
        }

        // Upload history for this session
        val sessionUploads = state.uploads.filter { it.session == session }
        if (sessionUploads.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            Text("Session Uploads", style = MaterialTheme.typography.labelLarge)
            Spacer(Modifier.height(6.dp))
            sessionUploads.forEach { upload ->
                val color = when (upload.status) {
                    UploadStatus.DONE -> MaterialTheme.colorScheme.primary
                    UploadStatus.FAILED -> MaterialTheme.colorScheme.error
                    UploadStatus.UPLOADING -> MaterialTheme.colorScheme.tertiary
                    UploadStatus.QUEUED -> MaterialTheme.colorScheme.onSurfaceVariant
                }
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        "${upload.photoType}${upload.sealPosition?.let { " ($it)" } ?: ""}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Text(upload.status.name, style = MaterialTheme.typography.bodySmall, color = color)
                }
                HorizontalDivider()
            }
        }
    }
}

// ── Camera composable ─────────────────────────────────────────────────────────

@Composable
fun CameraCapture(
    onImageCaptured: (File) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val cameraExecutor: Executor = remember { Executors.newSingleThreadExecutor() }

    var imageCapture: ImageCapture? by remember { mutableStateOf(null) }
    var capturing by remember { mutableStateOf(false) }
    // Held so DisposableEffect can unbind on the way out — without this the
    // preview surface is torn down (navigating away) while CameraX still
    // thinks it owns it, so the next visit binds a second session on top of
    // a never-released one and the PreviewView renders black instead of a
    // live feed.
    var cameraProvider by remember { mutableStateOf<ProcessCameraProvider?>(null) }

    DisposableEffect(Unit) {
        onDispose {
            cameraProvider?.unbindAll()
            cameraExecutor.shutdown()
        }
    }

    Box(modifier = modifier) {
        AndroidView(
            factory = { ctx ->
                val previewView = PreviewView(ctx)
                val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
                cameraProviderFuture.addListener({
                    val provider = cameraProviderFuture.get()
                    cameraProvider = provider
                    val preview = Preview.Builder().build().also {
                        it.surfaceProvider = previewView.surfaceProvider
                    }
                    val ic = ImageCapture.Builder()
                        .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                        .build()
                    imageCapture = ic
                    try {
                        provider.unbindAll()
                        provider.bindToLifecycle(
                            lifecycleOwner,
                            CameraSelector.DEFAULT_BACK_CAMERA,
                            preview, ic,
                        )
                    } catch (e: Exception) {
                        Log.e("CameraCapture", "Bind failed", e)
                    }
                }, ContextCompat.getMainExecutor(ctx))
                previewView
            },
            modifier = Modifier.fillMaxSize(),
        )
        FloatingActionButton(
            onClick = {
                val ic = imageCapture ?: return@FloatingActionButton
                if (capturing) return@FloatingActionButton
                capturing = true
                val file = File(context.cacheDir, "photo_${System.currentTimeMillis()}.jpg")
                val opts = ImageCapture.OutputFileOptions.Builder(file).build()
                ic.takePicture(opts, cameraExecutor, object : ImageCapture.OnImageSavedCallback {
                    override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                        capturing = false
                        onImageCaptured(file)
                    }
                    override fun onError(exc: ImageCaptureException) {
                        capturing = false
                        Log.e("CameraCapture", "Capture error", exc)
                    }
                })
            },
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp),
        ) {
            if (capturing) CircularProgressIndicator(Modifier.size(24.dp))
            else Icon(Icons.Default.Camera, contentDescription = "Capture")
        }
    }
}

// ── Permission helper ─────────────────────────────────────────────────────────

@Composable
private fun PermissionRequest(message: String, onRequest: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Default.Lock, contentDescription = null, modifier = Modifier.size(40.dp))
            Spacer(Modifier.height(8.dp))
            Text(message, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(12.dp))
            Button(onClick = onRequest, modifier = Modifier.fillMaxWidth()) {
                Text("Grant Permissions")
            }
        }
    }
}

// ── Location helper ───────────────────────────────────────────────────────────

private suspend fun getLastKnownLocation(context: Context): Location? =
    suspendCancellableCoroutine { cont ->
        try {
            val fusedClient = LocationServices.getFusedLocationProviderClient(context)
            fusedClient.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, null)
                .addOnSuccessListener { loc -> cont.resume(loc) }
                .addOnFailureListener { cont.resume(null) }
        } catch (_: SecurityException) {
            cont.resume(null)
        }
    }
