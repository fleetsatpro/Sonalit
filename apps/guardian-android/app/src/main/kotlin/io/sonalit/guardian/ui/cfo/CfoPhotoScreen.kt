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
import kotlinx.coroutines.delay
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

/**
 * One entry in the single, ordered capture sequence spanning every assigned
 * truck. Flattening per-truck slots into one global list is what lets us
 * enforce a strict "one next action" wizard — front, then rear, then each
 * seal, per truck in position order, then the next truck — instead of a
 * grid the CFO can tap anywhere on.
 */
data class TruckSlot(
    val truck: AssignedTruck,
    val slot: PhotoSlot,
)

private fun buildGlobalSlots(
    trucks: List<AssignedTruck>,
    sealCount: Int,
    photos: List<PhotoRecord>,
    session: String,
): List<TruckSlot> =
    trucks.sortedBy { it.position }.flatMap { truck ->
        val truckPhotos = photos.filter { it.convoy_truck_id == truck.id && it.session == session }
        buildSlots(sealCount, truckPhotos).map { TruckSlot(truck, it) }
    }

private fun nextIncompleteGlobal(slots: List<TruckSlot>): TruckSlot? =
    slots.firstOrNull { !it.slot.isComplete }

private fun sameSlot(a: PhotoSlot, b: PhotoSlot): Boolean =
    a.photoType == b.photoType && a.sealPosition == b.sealPosition

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

    var captureTarget by remember { mutableStateOf<TruckSlot?>(null) }
    var showSealDialog by remember { mutableStateOf(false) }
    var pendingSealTarget by remember { mutableStateOf<TruckSlot?>(null) }
    var retakeConfirmTarget by remember { mutableStateOf<TruckSlot?>(null) }

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

    // The single source of truth for ordering: front, then rear, then each seal,
    // per truck in position order, then the next truck. The CFO can only ever
    // act on nextIncompleteGlobal() — everything after it is locked in the
    // checklist below, which is what makes duplication/skipping impossible.
    val globalSlots = buildGlobalSlots(
        ctx.assigned_trucks, ctx.convoy.seal_count_per_truck, ctx.photos_today, session
    )

    fun startCapture(target: TruckSlot) {
        if (target.slot.photoType == "seal" && target.slot.sealPosition == null) {
            pendingSealTarget = target
            showSealDialog = true
        } else {
            captureTarget = target
        }
    }

    val target = captureTarget
    if (target != null) {
        val currentIndex = globalSlots.indexOfFirst {
            it.truck.id == target.truck.id && sameSlot(it.slot, target.slot)
        }.let { if (it < 0) 0 else it }

        SlotCaptureScreen(
            viewModel = viewModel,
            truck = target.truck,
            session = session,
            slot = target.slot,
            slotIndex = currentIndex,
            totalSlots = globalSlots.size,
            onAdvance = { next ->
                if (next != null) startCapture(next) else captureTarget = null
            },
            onBack = { captureTarget = null },
        )
    } else {
        PhotoChecklistScreen(
            trucks = ctx.assigned_trucks,
            photos = ctx.photos_today,
            session = session,
            sessionLabel = sessionLabel,
            sealCount = ctx.convoy.seal_count_per_truck,
            convoyName = ctx.convoy.name,
            onNextSlotTap = { truck, slot -> startCapture(TruckSlot(truck, slot)) },
            onRetakeTap = { truck, slot -> retakeConfirmTarget = TruckSlot(truck, slot) },
            onBack = { viewModel.navigate(CfoNavScreen.DASHBOARD) },
        )
    }

    if (showSealDialog) {
        // Seal codes are physical RFID tag IDs — the same code entered for two
        // slots on one truck would silently overwrite the first seal's photo
        // record (backend replaces by truck+session+seal_position), so catch
        // the duplicate here instead of letting it happen invisibly.
        val usedSealCodes = pendingSealTarget?.let { pending ->
            ctx.photos_today.filter {
                it.convoy_truck_id == pending.truck.id && it.session == session && it.photo_type == "seal"
            }.mapNotNull { it.seal_position }.toSet()
        } ?: emptySet()

        SealPositionDialog(
            usedCodes = usedSealCodes,
            onConfirm = { pos ->
                pendingSealTarget?.let { pending ->
                    captureTarget = TruckSlot(pending.truck, PhotoSlot("seal", pos, "Seal $pos", false))
                }
                pendingSealTarget = null
                showSealDialog = false
            },
            onDismiss = {
                showSealDialog = false
                pendingSealTarget = null
            },
        )
    }

    retakeConfirmTarget?.let { rt ->
        RetakeConfirmDialog(
            truck = rt.truck,
            slot = rt.slot,
            onConfirm = {
                retakeConfirmTarget = null
                startCapture(rt)
            },
            onDismiss = { retakeConfirmTarget = null },
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
    onNextSlotTap: (truck: AssignedTruck, slot: PhotoSlot) -> Unit,
    onRetakeTap: (truck: AssignedTruck, slot: PhotoSlot) -> Unit,
    onBack: () -> Unit,
) {
    val orderedTrucks = trucks.sortedBy { it.position }
    val globalSlots = buildGlobalSlots(orderedTrucks, sealCount, photos, session)
    val nextTarget = nextIncompleteGlobal(globalSlots)

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
        Spacer(Modifier.height(4.dp))
        Text(
            if (nextTarget != null)
                "Follow the checklist in order — one photo at a time, no skipping."
            else "All photos captured for this session.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(12.dp))

        orderedTrucks.forEach { truck ->
            val truckPhotos = photos.filter {
                it.convoy_truck_id == truck.id && it.session == session
            }
            val slots = buildSlots(sealCount, truckPhotos)
            val done = slots.count { it.isComplete }
            val isActiveTruck = nextTarget?.truck?.id == truck.id

            TruckPhotoCard(
                truck = truck,
                slots = slots,
                done = done,
                total = slots.size,
                isActiveTruck = isActiveTruck,
                isNextSlot = { slot -> isActiveTruck && nextTarget != null && sameSlot(nextTarget.slot, slot) },
                onNextSlotTap = { slot -> onNextSlotTap(truck, slot) },
                onRetakeTap = { slot -> onRetakeTap(truck, slot) },
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
    isActiveTruck: Boolean,
    isNextSlot: (PhotoSlot) -> Boolean,
    onNextSlotTap: (PhotoSlot) -> Unit,
    onRetakeTap: (PhotoSlot) -> Unit,
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

            slots.forEach { slot ->
                val locked = !slot.isComplete && !isNextSlot(slot)
                PhotoSlotRow(
                    slot = slot,
                    locked = locked,
                    onTap = {
                        if (slot.isComplete) onRetakeTap(slot)
                        else if (isNextSlot(slot)) onNextSlotTap(slot)
                    },
                )
            }

            if (!allDone) {
                Spacer(Modifier.height(8.dp))
                val nextSlot = nextIncompleteSlot(slots)
                if (isActiveTruck && nextSlot != null) {
                    Button(
                        onClick = { onNextSlotTap(nextSlot) },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Default.CameraAlt, contentDescription = null, Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Capture ${nextSlot.label}")
                    }
                } else {
                    Spacer(Modifier.height(4.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Lock, contentDescription = null,
                            modifier = Modifier.size(14.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.width(6.dp))
                        Text(
                            "Finish the truck above first",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            } else {
                Spacer(Modifier.height(4.dp))
                Text(
                    "All photos captured — tap a photo above to retake it",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun PhotoSlotRow(slot: PhotoSlot, locked: Boolean, onTap: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = !locked, onClick = onTap)
            .padding(vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            when {
                slot.isComplete -> Icons.Default.CheckCircle
                locked -> Icons.Default.Lock
                else -> Icons.Default.RadioButtonUnchecked
            },
            contentDescription = null,
            modifier = Modifier.size(18.dp),
            tint = when {
                slot.isComplete -> MaterialTheme.colorScheme.primary
                locked -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                else -> MaterialTheme.colorScheme.primary
            },
        )
        Spacer(Modifier.width(10.dp))
        Text(
            slot.label,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = if (!slot.isComplete && !locked) FontWeight.SemiBold else FontWeight.Normal,
            color = when {
                locked -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                slot.isComplete -> MaterialTheme.colorScheme.onSurfaceVariant
                else -> MaterialTheme.colorScheme.onSurface
            },
        )
        Spacer(Modifier.weight(1f))
        when {
            slot.isComplete -> Icon(Icons.Default.Refresh, contentDescription = "Retake",
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant)
            !locked -> Icon(Icons.Default.ChevronRight, contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = MaterialTheme.colorScheme.primary)
        }
    }
    HorizontalDivider(thickness = 0.5.dp)
}

@Composable
private fun RetakeConfirmDialog(truck: AssignedTruck, slot: PhotoSlot, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Default.Refresh, contentDescription = null) },
        title = { Text("Retake ${slot.label}?") },
        text = {
            Text(
                "This replaces the existing ${slot.label.lowercase()} photo for " +
                    "${truck.plate_number ?: truck.id.take(8)}. The old photo will no longer count.",
                style = MaterialTheme.typography.bodyMedium,
            )
        },
        confirmButton = { Button(onClick = onConfirm) { Text("Retake") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
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
    onAdvance: (TruckSlot?) -> Unit,
    onBack: () -> Unit,
) {
    // Slot labels (e.g. "Front") repeat across trucks, so remember() must key
    // on truck.id too — otherwise state from truck A's "Front" would leak into
    // truck B's "Front" when the wizard advances across trucks.
    var capturedFile by remember(truck.id, slot.label) { mutableStateOf<File?>(null) }
    var lastLocation by remember { mutableStateOf<Location?>(null) }
    var uploadEventId by remember(truck.id, slot.label) { mutableStateOf<String?>(null) }
    // A retake replaces an already-captured slot — after it uploads, return
    // straight to the checklist instead of auto-advancing into the guided
    // flow for whatever slot happens to still be incomplete elsewhere.
    val isRetake = remember(truck.id, slot.label) { slot.isComplete }
    val context = LocalContext.current
    val state by viewModel.state.collectAsState()
    val ctx = state.context

    // Keep trying for a fix rather than a one-shot read — a cold GPS often
    // returns null on first ask, which used to leave the whole capture reading
    // "not available". Upload never waits on this; it just fills in when ready.
    LaunchedEffect(Unit) {
        var tries = 0
        while (lastLocation == null && tries < 8) {
            lastLocation = getLastKnownLocation(context)
            if (lastLocation == null) { tries++; delay(1500) }
        }
    }

    LaunchedEffect(state.uploads, ctx?.photos_today) {
        val eid = uploadEventId ?: return@LaunchedEffect
        val upload = state.uploads.find { it.eventUuid == eid }
        if (upload?.status == UploadStatus.DONE && ctx != null) {
            uploadEventId = null
            if (isRetake) {
                onAdvance(null)
            } else {
                val updatedGlobalSlots = buildGlobalSlots(
                    ctx.assigned_trucks, ctx.convoy.seal_count_per_truck, ctx.photos_today, session
                )
                onAdvance(nextIncompleteGlobal(updatedGlobalSlots))
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
                // Review only — the single Retake / Use-photo action bar lives
                // below, so there's never a second button floating on the image.
                AsyncImage(
                    model = capturedFile,
                    contentDescription = "Captured photo",
                    modifier = Modifier.fillMaxSize(),
                )
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
                            "GPS locked · ${String.format("%.5f", lastLocation!!.latitude)}, ${String.format("%.5f", lastLocation!!.longitude)}"
                        else "Locating GPS… photo still saves",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.height(12.dp))
                if (capturedFile == null) {
                    // Camera live — one instruction, no dead/disabled buttons.
                    Text(
                        "Tap the shutter to capture ${slot.label}.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                } else {
                    // Photo taken — exactly two choices, primary vs secondary.
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        OutlinedButton(
                            onClick = { capturedFile = null },
                            enabled = !isUploading,
                            modifier = Modifier.height(48.dp),
                        ) {
                            Icon(Icons.Default.Refresh, contentDescription = null, Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Retake")
                        }
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
                            enabled = !isUploading,
                            modifier = Modifier.weight(1f).height(48.dp),
                        ) {
                            if (isUploading) {
                                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                                Spacer(Modifier.width(8.dp))
                                Text("Uploading…")
                            } else {
                                Icon(Icons.Default.CloudUpload, contentDescription = null)
                                Spacer(Modifier.width(8.dp))
                                Text(if (isRetake) "Replace ${slot.label}" else "Use photo")
                            }
                        }
                    }
                }
            }
        }
    }
}

// ── Seal Position Dialog ─────────────────────────────────────────────────────

@Composable
private fun SealPositionDialog(usedCodes: Set<String>, onConfirm: (String) -> Unit, onDismiss: () -> Unit) {
    var position by remember { mutableStateOf("") }
    val isDuplicate = position.isNotBlank() && usedCodes.contains(position)

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Default.Security, contentDescription = null) },
        title = { Text("Enter Seal Code") },
        text = {
            Column {
                Text("Enter the RFID seal code printed on the seal tag.",
                    style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = position,
                    onValueChange = { position = it.trim() },
                    label = { Text("Seal Code (e.g. 0099)") },
                    singleLine = true,
                    isError = isDuplicate,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (isDuplicate) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "This code is already recorded for this truck — enter the next seal's code.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(position) },
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
        LargeFloatingActionButton(
            onClick = {
                val ic = imageCapture ?: return@LargeFloatingActionButton
                if (capturing) return@LargeFloatingActionButton
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
            containerColor = MaterialTheme.colorScheme.primary,
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 20.dp),
        ) {
            if (capturing) CircularProgressIndicator(Modifier.size(30.dp), strokeWidth = 3.dp)
            else Icon(Icons.Default.Camera, contentDescription = "Capture", Modifier.size(36.dp))
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
