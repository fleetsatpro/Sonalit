package io.sonalit.guardian.ui.cfo

import android.Manifest
import android.content.Context
import android.location.Location
import android.util.Log
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.rememberMultiplePermissionsState
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import io.sonalit.guardian.data.remote.AssignedTruck
import io.sonalit.guardian.data.remote.PhotoRecord
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

data class PhotoSlot(
    val photoType: String,
    val sealPosition: String?,
    val label: String,
    val isComplete: Boolean,
)

private fun buildSlots(
    sealCount: Int,
    photos: List<PhotoRecord>,
): List<PhotoSlot> {
    val front = photos.find { it.photo_type == "front" }
    val rear = photos.find { it.photo_type == "rear" }
    val seals = photos.filter { it.photo_type == "seal" }

    val slots = mutableListOf<PhotoSlot>()
    slots.add(PhotoSlot("front", null, "Front", front != null))
    slots.add(PhotoSlot("rear", null, "Rear", rear != null))

    seals.sortedBy { it.seal_position }.forEach { s ->
        slots.add(PhotoSlot("seal", s.seal_position, "Seal ${s.seal_position}", true))
    }
    val remaining = sealCount - seals.size
    for (i in 1..maxOf(0, remaining)) {
        slots.add(PhotoSlot("seal", null, "Seal #${seals.size + i}", false))
    }
    return slots
}

private fun nextIncompleteSlot(slots: List<PhotoSlot>): PhotoSlot? =
    slots.firstOrNull { !it.isComplete }

// Guided capture is strict: front, then rear, then each seal in turn. A slot can
// only be tapped if it's already complete (retake) or it's the single next slot
// in the sequence — this stops a CFO from skipping ahead to seals before the
// front/rear photos exist.
private fun slotInstruction(slot: PhotoSlot): String = when (slot.photoType) {
    "front" -> "Stand facing the FRONT of the truck. Frame the whole cab and number plate clearly."
    "rear" -> "Walk to the REAR of the truck. Frame the whole rear and number plate clearly."
    "seal" -> "Take a close-up of seal ${slot.sealPosition.orEmpty()} — make sure the code on the tag is readable."
    else -> "Take the photo for ${slot.label}."
}

// ── Main Screen ──────────────────────────────────────────────────────────────

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

    var captureTruckId by remember { mutableStateOf<String?>(null) }
    var captureSlot by remember { mutableStateOf<PhotoSlot?>(null) }
    var showSealDialog by remember { mutableStateOf(false) }

    if (ctx == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("No convoy context loaded.", color = MaterialTheme.colorScheme.error)
        }
        return
    }

    if (!permsState.allPermissionsGranted) {
        Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
            PermissionRequest(
                message = "Camera and location are required to capture geo-stamped photos.",
                onRequest = { permsState.launchMultiplePermissionRequest() },
            )
        }
        return
    }

    if (captureTruckId != null && captureSlot != null) {
        val truck = ctx.assigned_trucks.find { it.id == captureTruckId }
        if (truck != null) {
            val truckPhotos = ctx.photos_today.filter {
                it.convoy_truck_id == truck.id && it.session == session
            }
            val slots = buildSlots(ctx.convoy.seal_count_per_truck, truckPhotos)
            val currentIndex = slots.indexOfFirst {
                it.photoType == captureSlot!!.photoType &&
                    it.sealPosition == captureSlot!!.sealPosition &&
                    it.label == captureSlot!!.label
            }.let { if (it < 0) 0 else it }

            SlotCaptureScreen(
                viewModel = viewModel,
                truck = truck,
                session = session,
                slot = captureSlot!!,
                slotIndex = currentIndex,
                totalSlots = slots.size,
                onAdvance = { next ->
                    if (next != null) {
                        if (next.photoType == "seal" && next.sealPosition == null) {
                            captureSlot = next
                            showSealDialog = true
                        } else {
                            captureSlot = next
                        }
                    } else {
                        captureTruckId = null
                        captureSlot = null
                    }
                },
                onBack = { captureTruckId = null; captureSlot = null },
            )
        }
    } else {
        PhotoChecklistScreen(
            trucks = ctx.assigned_trucks,
            photos = ctx.photos_today,
            session = session,
            sessionLabel = sessionLabel,
            sealCount = ctx.convoy.seal_count_per_truck,
            convoyName = ctx.convoy.name,
            onSlotTap = { truckId, slot ->
                captureTruckId = truckId
                if (slot.photoType == "seal" && slot.sealPosition == null) {
                    captureSlot = slot
                    showSealDialog = true
                } else {
                    captureSlot = slot
                }
            },
            onBack = { viewModel.navigate(CfoNavScreen.DASHBOARD) },
        )
    }

    if (showSealDialog) {
        val existingSealPositions = remember(captureTruckId, ctx.photos_today) {
            ctx.photos_today
                .filter { it.convoy_truck_id == captureTruckId && it.session == session && it.photo_type == "seal" }
                .mapNotNull { it.seal_position }
                .toSet()
        }
        SealPositionDialog(
            existingPositions = existingSealPositions,
            onConfirm = { pos ->
                captureSlot = PhotoSlot("seal", pos, "Seal $pos", false)
                showSealDialog = false
            },
            onDismiss = {
                showSealDialog = false
                if (captureSlot?.isComplete != false) {
                    captureTruckId = null
                    captureSlot = null
                }
            },
        )
    }
}

// ── Checklist ────────────────────────────────────────────────────────────────

@Composable
private fun PhotoChecklistScreen(
    trucks: List<AssignedTruck>,
    photos: List<PhotoRecord>,
    session: String,
    sessionLabel: String,
    sealCount: Int,
    convoyName: String,
    onSlotTap: (truckId: String, slot: PhotoSlot) -> Unit,
    onBack: () -> Unit,
) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.Default.ArrowBack, contentDescription = "Back")
            }
            Column {
                Text("$sessionLabel Photos", style = MaterialTheme.typography.headlineSmall)
                Text(convoyName, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(Modifier.height(12.dp))

        trucks.forEach { truck ->
            val truckPhotos = photos.filter {
                it.convoy_truck_id == truck.id && it.session == session
            }
            val slots = buildSlots(sealCount, truckPhotos)
            val done = slots.count { it.isComplete }

            TruckPhotoCard(
                truck = truck,
                slots = slots,
                done = done,
                total = slots.size,
                onSlotTap = { slot -> onSlotTap(truck.id, slot) },
            )
            Spacer(Modifier.height(10.dp))
        }
    }
}

@Composable
private fun TruckPhotoCard(
    truck: AssignedTruck,
    slots: List<PhotoSlot>,
    done: Int,
    total: Int,
    onSlotTap: (PhotoSlot) -> Unit,
) {
    val allDone = done >= total
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        if (allDone) Icons.Default.CheckCircle else Icons.Default.LocalShipping,
                        contentDescription = null,
                        tint = if (allDone) MaterialTheme.colorScheme.primary
                               else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(20.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Column {
                        Text(
                            truck.plate_number ?: truck.id.take(8),
                            fontWeight = FontWeight.Bold,
                            style = MaterialTheme.typography.bodyLarge,
                        )
                        Text(
                            "Position ${truck.position}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Text(
                    "$done / $total",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    color = if (allDone) MaterialTheme.colorScheme.primary
                           else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(Modifier.height(6.dp))
            LinearProgressIndicator(
                progress = { if (total > 0) done.toFloat() / total else 0f },
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(4.dp)),
            )
            Spacer(Modifier.height(10.dp))

            val nextSlot = nextIncompleteSlot(slots)
            slots.forEach { slot ->
                val tappable = slot.isComplete || slot == nextSlot
                PhotoSlotRow(slot = slot, tappable = tappable, onTap = { if (tappable) onSlotTap(slot) })
            }

            if (!allDone) {
                Spacer(Modifier.height(8.dp))
                if (nextSlot != null) {
                    Button(
                        onClick = { onSlotTap(nextSlot) },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Default.CameraAlt, contentDescription = null, Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Capture ${nextSlot.label}")
                    }
                }
            } else {
                Spacer(Modifier.height(4.dp))
                Text(
                    "All photos captured — tap any photo above to retake it",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun PhotoSlotRow(slot: PhotoSlot, tappable: Boolean, onTap: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = tappable, onClick = onTap)
            .padding(vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            when {
                slot.isComplete -> Icons.Default.CheckCircle
                tappable -> Icons.Default.RadioButtonUnchecked
                else -> Icons.Default.Lock
            },
            contentDescription = null,
            modifier = Modifier.size(18.dp),
            tint = when {
                slot.isComplete -> MaterialTheme.colorScheme.primary
                tappable -> MaterialTheme.colorScheme.onSurfaceVariant
                else -> MaterialTheme.colorScheme.outline
            },
        )
        Spacer(Modifier.width(10.dp))
        Text(
            slot.label,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (slot.isComplete) FontWeight.Normal else FontWeight.SemiBold,
            color = when {
                slot.isComplete -> MaterialTheme.colorScheme.onSurfaceVariant
                tappable -> MaterialTheme.colorScheme.onSurface
                else -> MaterialTheme.colorScheme.outline
            },
        )
        Spacer(Modifier.weight(1f))
        when {
            slot.isComplete -> Icon(Icons.Default.Refresh, contentDescription = "Retake",
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant)
            tappable -> Icon(Icons.Default.ChevronRight, contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = MaterialTheme.colorScheme.primary)
            else -> Text(
                "Locked",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.outline,
            )
        }
    }
    HorizontalDivider(thickness = 0.5.dp)
}

// ── Capture Screen ───────────────────────────────────────────────────────────

@Composable
private fun SlotCaptureScreen(
    viewModel: CfoViewModel,
    truck: AssignedTruck,
    session: String,
    slot: PhotoSlot,
    slotIndex: Int,
    totalSlots: Int,
    onAdvance: (PhotoSlot?) -> Unit,
    onBack: () -> Unit,
) {
    var capturedFile by remember(slot.label) { mutableStateOf<File?>(null) }
    var lastLocation by remember { mutableStateOf<Location?>(null) }
    var uploadEventId by remember(slot.label) { mutableStateOf<String?>(null) }
    // A retake replaces an already-captured slot — after it uploads, return
    // straight to the checklist instead of auto-advancing into the guided
    // flow for whatever slot happens to still be incomplete elsewhere.
    val isRetake = remember(slot.label) { slot.isComplete }
    val context = LocalContext.current
    val state by viewModel.state.collectAsState()
    val ctx = state.context

    LaunchedEffect(Unit) { lastLocation = getLastKnownLocation(context) }

    LaunchedEffect(state.uploads, ctx?.photos_today) {
        val eid = uploadEventId ?: return@LaunchedEffect
        val upload = state.uploads.find { it.eventUuid == eid }
        if (upload?.status == UploadStatus.DONE && ctx != null) {
            uploadEventId = null
            if (isRetake) {
                onAdvance(null)
            } else {
                val updatedPhotos = ctx.photos_today.filter {
                    it.convoy_truck_id == truck.id && it.session == session
                }
                val updatedSlots = buildSlots(ctx.convoy.seal_count_per_truck, updatedPhotos)
                onAdvance(nextIncompleteSlot(updatedSlots))
            }
        }
    }

    val isUploading = uploadEventId != null &&
        state.uploads.any { it.eventUuid == uploadEventId && it.status == UploadStatus.UPLOADING }

    Column(Modifier.fillMaxSize()) {
        // Header
        Surface(tonalElevation = 2.dp) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                    Column(Modifier.weight(1f)) {
                        Text(
                            truck.plate_number ?: truck.id.take(8),
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                        )
                        Text(
                            if (isRetake) "Retake — ${slot.label}"
                            else "${slotIndex + 1} of $totalSlots — ${slot.label}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.primary,
                        )
                    }
                    Text(
                        session.uppercase(),
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                Spacer(Modifier.height(4.dp))
                LinearProgressIndicator(
                    progress = { (slotIndex + 1).toFloat() / totalSlots },
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(4.dp)),
                )
                if (!isRetake) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        slotInstruction(slot),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        }

        // Camera / Preview
        Box(
            modifier = Modifier.fillMaxWidth().weight(1f),
            contentAlignment = Alignment.Center,
        ) {
            if (capturedFile == null) {
                CameraCapture(
                    onImageCaptured = { capturedFile = it },
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                AsyncImage(
                    model = capturedFile,
                    contentDescription = "Captured photo",
                    modifier = Modifier.fillMaxSize(),
                )
                Row(
                    modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    FloatingActionButton(
                        onClick = { capturedFile = null },
                        containerColor = MaterialTheme.colorScheme.errorContainer,
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = "Retake")
                    }
                }
            }
        }

        // Bottom bar
        Surface(tonalElevation = 3.dp) {
            Column(Modifier.padding(16.dp)) {
                // GPS
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        if (lastLocation != null) Icons.Default.GpsFixed else Icons.Default.GpsOff,
                        contentDescription = null, modifier = Modifier.size(14.dp),
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
                Spacer(Modifier.height(10.dp))
                Button(
                    onClick = {
                        capturedFile?.let { file ->
                            val eid = java.util.UUID.randomUUID().toString()
                            uploadEventId = eid
                            viewModel.uploadPhoto(
                                file = file,
                                truckId = truck.id,
                                session = session,
                                photoType = slot.photoType,
                                sealPosition = slot.sealPosition,
                                location = lastLocation,
                                eventUuid = eid,
                            )
                        }
                    },
                    enabled = capturedFile != null && !isUploading,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                ) {
                    if (isUploading) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(8.dp))
                        Text("Uploading...")
                    } else {
                        Icon(Icons.Default.CloudUpload, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(if (isRetake) "Replace ${slot.label}" else "Upload ${slot.label}")
                    }
                }
            }
        }
    }
}

// ── Seal Position Dialog ─────────────────────────────────────────────────────

@Composable
private fun SealPositionDialog(
    existingPositions: Set<String>,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var position by remember { mutableStateOf("") }
    val normalized = position.trim().uppercase()
    val isDuplicate = normalized.isNotEmpty() &&
        existingPositions.any { it.trim().uppercase() == normalized }

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Default.Security, contentDescription = null) },
        title = { Text("Enter Seal Code") },
        text = {
            Column {
                Text("Enter the RFID seal code printed on the seal tag. Each seal must have a unique code — no duplicates.",
                    style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = position,
                    onValueChange = { position = it.trim() },
                    label = { Text("Seal Code (e.g. 0099)") },
                    singleLine = true,
                    isError = isDuplicate,
                    supportingText = if (isDuplicate) {
                        { Text("This code was already recorded for this truck today. Enter a different code.") }
                    } else null,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(position.trim()) },
                enabled = position.isNotBlank() && !isDuplicate,
            ) { Text("Continue") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

// ── Camera composable ────────────────────────────────────────────────────────

@Composable
fun CameraCapture(onImageCaptured: (File) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val cameraExecutor: ExecutorService = remember { Executors.newSingleThreadExecutor() }

    var imageCapture: ImageCapture? by remember { mutableStateOf(null) }
    var capturing by remember { mutableStateOf(false) }
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
                        provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, ic)
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

// ── Helpers ──────────────────────────────────────────────────────────────────

@Composable
private fun PermissionRequest(message: String, onRequest: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Default.Lock, contentDescription = null, modifier = Modifier.size(40.dp))
            Spacer(Modifier.height(8.dp))
            Text(message, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
            Button(onClick = onRequest, modifier = Modifier.fillMaxWidth()) {
                Text("Grant Permissions")
            }
        }
    }
}

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
