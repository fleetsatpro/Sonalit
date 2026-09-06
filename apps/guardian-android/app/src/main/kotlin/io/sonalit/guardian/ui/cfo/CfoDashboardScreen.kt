package io.sonalit.guardian.ui.cfo

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import io.sonalit.guardian.data.remote.AssignedTruck
import java.text.SimpleDateFormat
import java.util.Locale

@Composable
fun CfoDashboardScreen(viewModel: CfoViewModel) {
    val state by viewModel.state.collectAsState()
    val ctx = state.context

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        // Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text("CFO Dashboard", style = MaterialTheme.typography.headlineMedium)
                state.loggedInUser?.let {
                    Text(it.name, style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (state.contextLoading) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                }
                IconButton(onClick = { viewModel.loadContext(state.selectedDate) }) {
                    Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                }
                IconButton(onClick = { viewModel.logout() }) {
                    Icon(Icons.Default.Logout, contentDescription = "Logout")
                }
            }
        }
        LastUpdatedLabel(state.lastRefreshedAt)

        Spacer(Modifier.height(12.dp))

        if (state.convoyEnded) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
            ) {
                Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.CheckCircle, contentDescription = null,
                        modifier = Modifier.size(40.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
                    Spacer(Modifier.height(10.dp))
                    Text("Convoy Ended", style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimaryContainer)
                    Spacer(Modifier.height(4.dp))
                    Text("Handover form submitted. This convoy is complete.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.85f))
                }
            }
            return@Column
        }

        if (state.contextError != null) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
            ) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Warning, contentDescription = null,
                        tint = MaterialTheme.colorScheme.onErrorContainer)
                    Spacer(Modifier.width(8.dp))
                    Column {
                        Text("Failed to load convoy data", fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onErrorContainer)
                        Text(state.contextError!!, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer)
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            Button(onClick = { viewModel.loadContext(state.selectedDate) }, modifier = Modifier.fillMaxWidth()) {
                Text("Retry")
            }
            return@Column
        }

        if (ctx == null) {
            if (!state.contextLoading) {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Box(Modifier.padding(24.dp).fillMaxWidth(), contentAlignment = Alignment.Center) {
                        Text("No active convoy assignment found.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            return@Column
        }

        // Date picker
        if (ctx.available_dates.size > 1) {
            Text("Report Date", style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(6.dp))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(ctx.available_dates.sortedDescending()) { date ->
                    DateChip(
                        date = date,
                        isToday = date == ctx.today_date,
                        selected = date == state.selectedDate,
                        onClick = { viewModel.selectDate(date) },
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
        }

        if (state.isViewingHistory) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
            ) {
                Row(
                    Modifier.padding(12.dp).fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.History, contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSecondaryContainer)
                        Spacer(Modifier.width(8.dp))
                        Text("Viewing history — read only", fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSecondaryContainer)
                    }
                    TextButton(onClick = { viewModel.selectDate(ctx.today_date) }) {
                        Text("Back to Today")
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
        }

        // Convoy hero card
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
        ) {
            Column(Modifier.padding(18.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.LocalShipping, contentDescription = null,
                        modifier = Modifier.size(28.dp),
                        tint = MaterialTheme.colorScheme.onPrimaryContainer)
                    Spacer(Modifier.width(10.dp))
                    Text(ctx.convoy.name,
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onPrimaryContainer)
                }
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    InfoChip("Date", formatDateLabel(state.selectedDate ?: ctx.report_date))
                    InfoChip("Status", ctx.convoy.status.uppercase())
                    InfoChip("Trucks", "${ctx.assigned_trucks.size}")
                }
            }
        }
        Spacer(Modifier.height(12.dp))

        // Photo progress
        ctx.daily_report?.let { dr ->
            val pct = if (dr.required_photo_count > 0)
                dr.received_photo_count.toFloat() / dr.required_photo_count else 0f
            val statusColor = when (dr.status) {
                "complete", "generated" -> MaterialTheme.colorScheme.primary
                "partial" -> MaterialTheme.colorScheme.tertiary
                else -> MaterialTheme.colorScheme.error
            }
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp)) {
                    Row(
                        horizontalArrangement = Arrangement.SpaceBetween,
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("Photo Progress", style = MaterialTheme.typography.titleMedium)
                        Text("${dr.received_photo_count}/${dr.required_photo_count}",
                            style = MaterialTheme.typography.titleMedium,
                            color = statusColor)
                    }
                    Spacer(Modifier.height(10.dp))
                    LinearProgressIndicator(
                        progress = { pct },
                        modifier = Modifier.fillMaxWidth().height(10.dp).clip(RoundedCornerShape(6.dp)),
                        color = statusColor,
                    )
                    Spacer(Modifier.height(6.dp))
                    Text(dr.status.uppercase(),
                        style = MaterialTheme.typography.labelLarge,
                        color = statusColor)
                    if (dr.pdf_url != null) {
                        Spacer(Modifier.height(4.dp))
                        Text("Report PDF generated", style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
        }

        // Local-consignment convoys hand over through the CFO, not a handover
        // officer — this is what turns "photos uploaded" into "convoy ended".
        if (ctx.convoy.local_consignment && ctx.convoy.status == "completing") {
            if (ctx.handover != null) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
                ) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.CheckCircle, contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSecondaryContainer)
                        Spacer(Modifier.width(8.dp))
                        Text("Handover form submitted", color = MaterialTheme.colorScheme.onSecondaryContainer)
                    }
                }
            } else {
                Card(
                    modifier = Modifier.fillMaxWidth().clickable { viewModel.navigate(CfoNavScreen.HANDOVER) },
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer),
                ) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.AssignmentTurnedIn, contentDescription = null,
                            tint = MaterialTheme.colorScheme.onTertiaryContainer)
                        Spacer(Modifier.width(8.dp))
                        Column {
                            Text("Upload Handover Form", fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onTertiaryContainer)
                            Text("Ends this convoy once submitted",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onTertiaryContainer)
                        }
                    }
                }
            }
            Spacer(Modifier.height(12.dp))
        }

        if (state.pendingCount > 0) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer),
            ) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.CloudUpload, contentDescription = null,
                        tint = MaterialTheme.colorScheme.onTertiaryContainer)
                    Spacer(Modifier.width(8.dp))
                    Text("${state.pendingCount} photos queued for upload",
                        color = MaterialTheme.colorScheme.onTertiaryContainer,
                        style = MaterialTheme.typography.bodyLarge)
                }
            }
            Spacer(Modifier.height(12.dp))
        }

        // Per-truck breakdown
        if (ctx.assigned_trucks.isNotEmpty()) {
            Text("Trucks", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            ctx.assigned_trucks.forEach { truck ->
                TruckRow(
                    truck = truck,
                    photoCount = ctx.photos_today.count { it.convoy_truck_id == truck.id },
                    requiredCount = 2 * (2 + ctx.convoy.seal_count_per_truck),
                )
                Spacer(Modifier.height(8.dp))
            }
            Spacer(Modifier.height(8.dp))
        }

        // Action grid
        Text("Upload Photos", style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(8.dp))
        val uploadsEnabled = !state.isViewingHistory
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionCard(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.WbSunny,
                label = "Start of Day",
                subtitle = "SOD Photos",
                enabled = uploadsEnabled,
                onClick = { viewModel.navigate(CfoNavScreen.SOD) },
            )
            ActionCard(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.NightShelter,
                label = "End of Day",
                subtitle = "EOD Photos",
                enabled = uploadsEnabled,
                onClick = { viewModel.navigate(CfoNavScreen.EOD) },
            )
        }
        Spacer(Modifier.height(8.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionCard(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.Security,
                label = "Seals",
                subtitle = "Register RFID",
                enabled = uploadsEnabled,
                onClick = { viewModel.navigate(CfoNavScreen.SEALS) },
            )
            ActionCard(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.History,
                label = "History",
                subtitle = "Past uploads",
                enabled = true,
                onClick = { viewModel.navigate(CfoNavScreen.HISTORY) },
            )
        }
        Spacer(Modifier.height(8.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            // Always enabled, unlike the photo actions: a CFO needs to issue a
            // tracking QR and watch the board even on a day with no photo
            // window open — activation is not tied to the reporting cycle.
            ActionCard(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.QrCode2,
                label = "Tracking",
                subtitle = "QR + live status",
                enabled = true,
                onClick = { viewModel.navigate(CfoNavScreen.TRACKING) },
            )
            Spacer(Modifier.weight(1f))
        }
    }
}

@Composable
private fun LastUpdatedLabel(lastRefreshedAt: Long?) {
    if (lastRefreshedAt == null) return
    var secondsAgo by remember { mutableStateOf((System.currentTimeMillis() - lastRefreshedAt) / 1000) }
    LaunchedEffect(lastRefreshedAt) {
        while (true) {
            secondsAgo = (System.currentTimeMillis() - lastRefreshedAt) / 1000
            kotlinx.coroutines.delay(5_000)
        }
    }
    val label = when {
        secondsAgo < 5 -> "Updated just now"
        secondsAgo < 60 -> "Updated ${secondsAgo}s ago"
        else -> "Updated ${secondsAgo / 60}m ago"
    }
    Text(label, style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun DateChip(date: String, isToday: Boolean, selected: Boolean, onClick: () -> Unit) {
    val label = if (isToday) "Today" else formatDateLabel(date)
    val bg = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant
    val fg = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(bg)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = fg)
    }
}

private fun formatDateLabel(date: String): String = try {
    val parsed = SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(date)
    SimpleDateFormat("EEE d MMM", Locale.US).format(parsed!!)
} catch (_: Exception) {
    date
}

@Composable
private fun TruckRow(truck: AssignedTruck, photoCount: Int, requiredCount: Int) {
    val complete = photoCount >= requiredCount
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(14.dp).fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column {
                Text(truck.plate_number ?: truck.id.take(8), fontWeight = FontWeight.Bold)
                Text(
                    listOfNotNull(truck.make, truck.model).joinToString(" ").ifBlank { "Unknown vehicle" },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            SuggestionChip(
                onClick = {},
                label = {
                    Text("$photoCount/$requiredCount",
                        color = if (complete) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.tertiary)
                },
                icon = {
                    Icon(
                        if (complete) Icons.Default.CheckCircle else Icons.Default.RadioButtonUnchecked,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = if (complete) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.tertiary,
                    )
                },
            )
        }
    }
}

@Composable
private fun InfoChip(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(label, style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.75f))
        Text(value, style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onPrimaryContainer)
    }
}

@Composable
private fun ActionCard(
    modifier: Modifier = Modifier,
    icon: ImageVector,
    label: String,
    subtitle: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Card(
        modifier = modifier.clickable(enabled = enabled, onClick = onClick),
        colors = CardDefaults.cardColors(
            containerColor = if (enabled) MaterialTheme.colorScheme.surface
            else MaterialTheme.colorScheme.surface.copy(alpha = 0.5f),
        ),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(icon, contentDescription = label, modifier = Modifier.size(32.dp),
                tint = if (enabled) MaterialTheme.colorScheme.primary
                else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f))
            Spacer(Modifier.height(8.dp))
            Text(label, style = MaterialTheme.typography.titleSmall,
                color = if (enabled) MaterialTheme.colorScheme.onSurface
                else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f))
            Text(subtitle, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
