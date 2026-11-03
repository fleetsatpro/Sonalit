package io.sonalit.guardian.ui.cfo

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * Seal Register screen — shows per-truck seal slots, allows CFO to record
 * RFID codes and flag broken/missing seals. Seal photos are uploaded via
 * the SOD/EOD photo upload flow (photo_type = "seal").
 */
@Composable
fun CfoSealsScreen(viewModel: CfoViewModel) {
    val state by viewModel.state.collectAsState()
    val ctx = state.context

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { viewModel.navigate(CfoNavScreen.DASHBOARD) }) {
                Icon(Icons.Default.ArrowBack, contentDescription = "Back")
            }
            Text("Seal Register", style = MaterialTheme.typography.headlineSmall)
        }
        Spacer(Modifier.height(4.dp))
        Text(
            "Record RFID seal codes per truck. Use the SOD/EOD upload to capture seal photos.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(16.dp))

        if (ctx == null) {
            Text("No convoy context loaded.", color = MaterialTheme.colorScheme.error)
            return@Column
        }

        if (ctx.assigned_trucks.isEmpty()) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Box(Modifier.padding(24.dp).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Text("No trucks assigned to you for this convoy.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            return@Column
        }

        ctx.assigned_trucks.forEach { truck ->
            TruckSealCard(
                platNumber = truck.plate_number ?: truck.id.take(8),
                makeModel = listOfNotNull(truck.make, truck.model).joinToString(" ").ifBlank { "Unknown vehicle" },
                sealCount = ctx.convoy.seal_count_per_truck,
                photosToday = ctx.photos_today.filter {
                    it.convoy_truck_id == truck.id && it.photo_type == "seal"
                },
                onUploadSealPhoto = {
                    viewModel.selectTruck(truck.id)
                    viewModel.navigate(CfoNavScreen.SOD, truck.id)
                },
            )
            Spacer(Modifier.height(12.dp))
        }
    }
}

@Composable
private fun TruckSealCard(
    platNumber: String,
    makeModel: String,
    sealCount: Int,
    photosToday: List<io.sonalit.guardian.data.remote.PhotoRecord>,
    onUploadSealPhoto: () -> Unit,
) {
    var expanded by remember { mutableStateOf(true) }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            // Truck header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text(platNumber, fontWeight = FontWeight.Bold)
                    Text(makeModel, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    val sealPhotoCount = photosToday.size
                    SealStatusChip(sealPhotoCount, sealCount)
                    Spacer(Modifier.width(8.dp))
                    IconButton(onClick = { expanded = !expanded }) {
                        Icon(
                            if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                            contentDescription = "Toggle",
                        )
                    }
                }
            }

            if (expanded) {
                Spacer(Modifier.height(12.dp))
                HorizontalDivider()
                Spacer(Modifier.height(12.dp))

                // SOD seals
                SealSessionBlock(
                    session = "SOD",
                    sealCount = sealCount,
                    photos = photosToday.filter {
                        it.session == "sod" && it.photo_type == "seal"
                    },
                )
                Spacer(Modifier.height(8.dp))

                // EOD seals
                SealSessionBlock(
                    session = "EOD",
                    sealCount = sealCount,
                    photos = photosToday.filter {
                        it.session == "eod" && it.photo_type == "seal"
                    },
                )
                Spacer(Modifier.height(12.dp))

                OutlinedButton(
                    onClick = onUploadSealPhoto,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Default.AddAPhoto, contentDescription = null, Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Upload Seal Photo")
                }
            }
        }
    }
}

@Composable
private fun SealStatusChip(photoCount: Int, sealCount: Int) {
    val complete = photoCount >= sealCount * 2
    val color = if (complete) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.tertiary
    SuggestionChip(
        onClick = {},
        label = {
            Text("$photoCount/${sealCount * 2} seals",
                style = MaterialTheme.typography.labelSmall, color = color)
        },
        icon = {
            Icon(
                if (complete) Icons.Default.CheckCircle else Icons.Default.RadioButtonUnchecked,
                contentDescription = null,
                modifier = Modifier.size(14.dp),
                tint = color,
            )
        },
    )
}

@Composable
private fun SealSessionBlock(
    session: String,
    sealCount: Int,
    photos: List<io.sonalit.guardian.data.remote.PhotoRecord>,
) {
    Text(session, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
    Spacer(Modifier.height(4.dp))
    if (photos.isEmpty()) {
        Text("No seal photos uploaded for $session.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    } else {
        photos.forEach { photo ->
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Default.Lock, contentDescription = null, modifier = Modifier.size(14.dp),
                    tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(6.dp))
                Text("Position ${photo.seal_position ?: "?"}", style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.weight(1f))
                Text(photo.taken_at.take(10), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    if (photos.size < sealCount) {
        val missing = sealCount - photos.size
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Default.Warning, contentDescription = null, modifier = Modifier.size(12.dp),
                tint = MaterialTheme.colorScheme.error)
            Spacer(Modifier.width(4.dp))
            Text("$missing seal photo${if (missing != 1) "s" else ""} missing",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.error)
        }
    }
}
