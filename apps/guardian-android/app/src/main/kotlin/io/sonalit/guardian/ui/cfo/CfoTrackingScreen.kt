package io.sonalit.guardian.ui.cfo

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.common.BitMatrix
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import io.sonalit.guardian.data.remote.TrackingQrData
import io.sonalit.guardian.data.remote.TrackingVehicleStatus

/**
 * Tracking activation — Guardian's QR surface.
 *
 * Two views: a convoy board showing every truck's real tracking state, and a
 * full-bleed QR for the driver to scan. The board deliberately lists trucks
 * with no QR and trucks that have not scanned; a vehicle that never started
 * tracking is the row a CFO most needs to see, and hiding it would let the
 * board quietly report only what happens to be working.
 *
 * Status is never conveyed by colour alone — every state carries a text label
 * as well, so the board stays readable in sunlight and to a colour-blind
 * officer.
 */
@Composable
fun CfoTrackingScreen(
    onBack: () -> Unit,
    viewModel: CfoTrackingViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val qr = state.activeQr

    if (qr != null) {
        TrackingQrView(qr = qr, onBack = { viewModel.dismissQr() })
        return
    }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("Back") }
            Spacer(Modifier.weight(1f))
            TextButton(onClick = { viewModel.refresh() }) { Text("Refresh") }
        }

        Text("Tracking Activation", style = MaterialTheme.typography.headlineSmall)
        state.board?.convoy?.name?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.height(16.dp))

        state.error?.let {
            Text(it, color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(8.dp))
        }

        when {
            state.loading && state.board == null ->
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }

            state.board == null ->
                Text("No active convoy assigned to this device.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant)

            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(state.board!!.vehicles, key = { it.convoy_truck_id }) { v ->
                    VehicleRow(
                        vehicle = v,
                        generating = state.generatingFor == v.convoy_truck_id,
                        onGenerate = { viewModel.generateQr(v.convoy_truck_id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun VehicleRow(
    vehicle: TrackingVehicleStatus,
    generating: Boolean,
    onGenerate: () -> Unit,
) {
    val label = trackingLabel(vehicle.tracking_state)

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    vehicle.registration ?: "Vehicle ${vehicle.position ?: "?"}",
                    style = MaterialTheme.typography.titleMedium,
                    fontFamily = FontFamily.Monospace,
                )
                Spacer(Modifier.weight(1f))
                StatusPill(label = label.first, tone = label.second)
            }

            vehicle.driver_name?.let {
                Text(it, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            // Capability is shown SEPARATELY from tracking state. A vehicle can
            // be LIVE right now and still stop the moment the driver's phone
            // locks — the CFO has to be able to see both facts at once.
            vehicle.capability?.let { cap ->
                Spacer(Modifier.height(6.dp))
                val bg = when {
                    cap.background_reliable -> "Background: native, reliable"
                    cap.background_status == "unsupported" -> "Background: unsupported — driver must keep page open"
                    cap.background_status == "denied" -> "Background: denied"
                    else -> "Background: ${cap.background_status ?: "unknown"}"
                }
                Text(bg, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                vehicle.last_update_seconds?.let {
                    Text("Last fix ${formatAge(it)}", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                vehicle.confidence?.let {
                    if (vehicle.last_update_seconds != null) Spacer(Modifier.width(12.dp))
                    Text("Confidence ${it.uppercase()}", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Spacer(Modifier.weight(1f))
                if (generating) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                } else {
                    TextButton(onClick = onGenerate) {
                        // Regenerating supersedes the old code server-side, so
                        // the wording says what actually happens.
                        Text(if (vehicle.qr_status == null) "Generate QR" else "Regenerate")
                    }
                }
            }
        }
    }
}

private enum class Tone { Live, Warn, Bad, Idle }

@Composable
private fun StatusPill(label: String, tone: Tone) {
    val color = when (tone) {
        Tone.Live -> Color(0xFF33D6A8)
        Tone.Warn -> Color(0xFFFFB020)
        Tone.Bad -> Color(0xFFFF5C5C)
        Tone.Idle -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Text(
        label,
        color = color,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.Bold,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = 8.dp, vertical = 3.dp)
            // Colour is decoration; the label carries the meaning.
            .semantics { contentDescription = "Tracking status: $label" },
    )
}

private fun trackingLabel(state: String): Pair<String, Tone> = when (state) {
    "live" -> "LIVE" to Tone.Live
    "delayed" -> "DELAYED" to Tone.Warn
    "signal_lost" -> "SIGNAL LOST" to Tone.Warn
    "offline" -> "OFFLINE" to Tone.Bad
    "completed" -> "COMPLETED" to Tone.Idle
    "not_started" -> "STARTING" to Tone.Warn
    "scanned_not_activated" -> "SCANNED" to Tone.Warn
    "qr_not_scanned" -> "NOT SCANNED" to Tone.Idle
    "no_qr" -> "NO QR" to Tone.Idle
    else -> state.uppercase() to Tone.Idle
}

private fun formatAge(seconds: Int): String = when {
    seconds < 60 -> "${seconds}s ago"
    seconds < 3600 -> "${seconds / 60}m ago"
    else -> "${seconds / 3600}h ago"
}

// ── QR view ───────────────────────────────────────────────────────────────────

/**
 * Full-bleed QR for the driver to scan.
 *
 * Rendered on a forced white field at maximum contrast regardless of app theme:
 * this is scanned outdoors, off a screen, by a phone camera that may be dealing
 * with glare. Readability beats visual consistency here.
 */
@Composable
private fun TrackingQrView(qr: TrackingQrData, onBack: () -> Unit) {
    val screenWidth = LocalConfiguration.current.screenWidthDp.dp
    val qrSize = (screenWidth * 0.78f).coerceAtMost(360.dp)

    Column(
        modifier = Modifier.fillMaxSize().padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("Done") }
        }

        Text("TRACKING ACTIVATION", style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(6.dp))

        Text(
            qr.display?.vehicle ?: "Vehicle",
            style = MaterialTheme.typography.headlineMedium,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Bold,
        )
        qr.display?.driver?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        Spacer(Modifier.height(20.dp))

        Box(
            modifier = Modifier
                .size(qrSize + 24.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(Color.White),
            contentAlignment = Alignment.Center,
        ) {
            QrCanvas(content = qr.url, size = qrSize)
        }

        Spacer(Modifier.height(20.dp))

        qr.display?.convoy?.let {
            LabelledValue("CONVOY", it)
        }
        LabelledValue("TRACKING SOURCE", "Guardian GPS")
        LabelledValue(
            "TRACKING ENDS",
            when (qr.termination_policy) {
                "convoy_ended" -> "When the convoy ends"
                "container_delivered" -> "On container delivery"
                "all_containers_delivered" -> "When all containers are delivered"
                else -> qr.termination_policy.replace('_', ' ')
            },
        )

        Spacer(Modifier.height(18.dp))
        Text(
            "Waiting for the driver to scan.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun LabelledValue(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Text(label, style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
    }
}

/**
 * Draws a QR straight onto a Canvas from the zxing BitMatrix.
 *
 * Avoids allocating an Android Bitmap per recomposition; the matrix is
 * remembered against the content so re-layout does not re-encode. Encoding is
 * wrapped because a writer failure must not take the screen down — the CFO gets
 * a legible error and can regenerate.
 */
@Composable
private fun QrCanvas(content: String, size: androidx.compose.ui.unit.Dp) {
    val matrix: BitMatrix? = remember(content) {
        runCatching {
            QRCodeWriter().encode(
                content,
                BarcodeFormat.QR_CODE,
                512, 512,
                mapOf(
                    // Higher correction survives glare, fingerprints and a
                    // slightly dirty screen at the roadside.
                    EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.Q,
                    EncodeHintType.MARGIN to 1,
                ),
            )
        }.getOrNull()
    }

    if (matrix == null) {
        Text("Could not render QR", color = Color.Black)
        return
    }

    Canvas(
        modifier = Modifier
            .size(size)
            .semantics { contentDescription = "Tracking activation QR code" },
    ) {
        val cols = matrix.width
        val rows = matrix.height
        val cell = kotlin.math.min(this.size.width / cols, this.size.height / rows)
        val offsetX = (this.size.width - cell * cols) / 2f
        val offsetY = (this.size.height - cell * rows) / 2f

        for (y in 0 until rows) {
            for (x in 0 until cols) {
                if (matrix.get(x, y)) {
                    drawRect(
                        color = Color.Black,
                        topLeft = Offset(offsetX + x * cell, offsetY + y * cell),
                        // +0.5 closes hairline seams between cells that some
                        // scanners read as module gaps.
                        size = Size(cell + 0.5f, cell + 0.5f),
                    )
                }
            }
        }
    }
}
