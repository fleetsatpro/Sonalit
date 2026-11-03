package io.sonalit.guardian.ui.cfo

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.sonalit.guardian.data.remote.PhotoRecord

/**
 * History screen — shows all photos uploaded during the current convoy context,
 * grouped by date and session. This is derived from the photos_today list in
 * the CFO context payload (the backend returns photos for the current report_date).
 */
@Composable
fun CfoHistoryScreen(viewModel: CfoViewModel) {
    val state by viewModel.state.collectAsState()
    val ctx = state.context

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
        ) {
            IconButton(onClick = { viewModel.navigate(CfoNavScreen.DASHBOARD) }) {
                Icon(Icons.Default.ArrowBack, contentDescription = "Back")
            }
            Text("Upload History", style = MaterialTheme.typography.headlineSmall)
        }

        if (ctx == null) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("No convoy context loaded.", color = MaterialTheme.colorScheme.error)
            }
            return@Column
        }

        val allPhotos = ctx.photos_today
        if (allPhotos.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.PhotoLibrary, contentDescription = null,
                        modifier = Modifier.size(48.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(12.dp))
                    Text("No photos uploaded yet today.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(4.dp))
                    Text("Use the SOD or EOD screens to upload photos.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            return@Column
        }

        // Group by session
        val bySession = allPhotos.groupBy { it.session }

        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            // Summary card
            item {
                SummaryCard(
                    total = allPhotos.size,
                    sod = bySession["sod"]?.size ?: 0,
                    eod = bySession["eod"]?.size ?: 0,
                    date = ctx.report_date,
                )
            }

            // SOD group
            if (bySession.containsKey("sod")) {
                item {
                    SessionHeader("Start of Day (SOD)", bySession["sod"]!!.size)
                }
                items(bySession["sod"]!!) { photo ->
                    PhotoHistoryRow(
                        photo = photo,
                        truckLabel = ctx.assigned_trucks.find { it.id == photo.convoy_truck_id }
                            ?.plate_number ?: photo.convoy_truck_id.take(8),
                    )
                }
            }

            // EOD group
            if (bySession.containsKey("eod")) {
                item {
                    SessionHeader("End of Day (EOD)", bySession["eod"]!!.size)
                }
                items(bySession["eod"]!!) { photo ->
                    PhotoHistoryRow(
                        photo = photo,
                        truckLabel = ctx.assigned_trucks.find { it.id == photo.convoy_truck_id }
                            ?.plate_number ?: photo.convoy_truck_id.take(8),
                    )
                }
            }

            // Queued offline uploads
            val pendingUploads = state.uploads.filter {
                it.status == UploadStatus.QUEUED || it.status == UploadStatus.UPLOADING
            }
            if (pendingUploads.isNotEmpty()) {
                item {
                    SessionHeader("Pending Upload (${pendingUploads.size})", pendingUploads.size, isError = true)
                }
                items(pendingUploads) { upload ->
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.errorContainer
                        ),
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column {
                                Text(
                                    "${upload.photoType}${upload.sealPosition?.let { " ($it)" } ?: ""}",
                                    fontWeight = FontWeight.SemiBold,
                                    style = MaterialTheme.typography.bodySmall,
                                )
                                Text(upload.error ?: "Queued for retry",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onErrorContainer)
                            }
                            Icon(
                                if (upload.status == UploadStatus.UPLOADING)
                                    Icons.Default.CloudSync else Icons.Default.CloudOff,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onErrorContainer,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SummaryCard(total: Int, sod: Int, eod: Int, date: String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
    ) {
        Row(
            modifier = Modifier.padding(16.dp).fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            SummaryItem("Date", date)
            SummaryItem("Total", "$total")
            SummaryItem("SOD", "$sod")
            SummaryItem("EOD", "$eod")
        }
    }
}

@Composable
private fun SummaryItem(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onPrimaryContainer)
        Text(label, style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onPrimaryContainer)
    }
}

@Composable
private fun SessionHeader(label: String, count: Int, isError: Boolean = false) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            if (isError) Icons.Default.CloudOff else Icons.Default.CheckCircle,
            contentDescription = null,
            modifier = Modifier.size(16.dp),
            tint = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.width(6.dp))
        Text(label, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.weight(1f))
        Text("$count photo${if (count != 1) "s" else ""}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    HorizontalDivider()
}

@Composable
private fun PhotoHistoryRow(photo: PhotoRecord, truckLabel: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val icon = when (photo.photo_type) {
            "front" -> Icons.Default.DirectionsCar
            "rear" -> Icons.Default.DirectionsCarFilled
            else -> Icons.Default.Lock
        }
        Icon(icon, contentDescription = null, modifier = Modifier.size(16.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(
                "$truckLabel · ${photo.photo_type}${photo.seal_position?.let { " ($it)" } ?: ""}",
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                photo.taken_at.replace("T", " ").take(19),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Icon(Icons.Default.CloudDone, contentDescription = "Uploaded",
            modifier = Modifier.size(16.dp),
            tint = MaterialTheme.colorScheme.primary)
    }
    HorizontalDivider(thickness = 0.5.dp)
}
