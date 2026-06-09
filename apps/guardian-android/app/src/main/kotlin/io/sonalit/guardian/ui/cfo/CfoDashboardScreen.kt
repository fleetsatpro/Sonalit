package io.sonalit.guardian.ui.cfo

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

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
                Text("CFO Dashboard", style = MaterialTheme.typography.headlineSmall)
                state.loggedInUser?.let {
                    Text(it.name, style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            IconButton(onClick = { viewModel.logout() }) {
                Icon(Icons.Default.Logout, contentDescription = "Logout")
            }
        }

        Spacer(Modifier.height(16.dp))

        if (state.contextLoading) {
            Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
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
                        Text("Failed to load convoy data", fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onErrorContainer)
                        Text(state.contextError!!, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer)
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
            Button(onClick = { viewModel.loadContext() }, modifier = Modifier.fillMaxWidth()) {
                Text("Retry")
            }
            return@Column
        }

        if (ctx == null) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Box(Modifier.padding(24.dp).fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Text("No active convoy assignment found.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            return@Column
        }

        // Convoy hero card
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
        ) {
            Column(Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.LocalShipping, contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer)
                    Spacer(Modifier.width(8.dp))
                    Text(ctx.convoy.name,
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onPrimaryContainer)
                }
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    InfoChip("Date", ctx.report_date)
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
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Row(
                        horizontalArrangement = Arrangement.SpaceBetween,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Photo Progress", fontWeight = FontWeight.SemiBold)
                        Text("${dr.received_photo_count}/${dr.required_photo_count}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Spacer(Modifier.height(8.dp))
                    LinearProgressIndicator(
                        progress = { pct },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(dr.status.uppercase(),
                        style = MaterialTheme.typography.labelSmall,
                        color = when (dr.status) {
                            "complete", "generated" -> MaterialTheme.colorScheme.primary
                            "partial" -> MaterialTheme.colorScheme.tertiary
                            else -> MaterialTheme.colorScheme.onSurfaceVariant
                        })
                }
            }
            Spacer(Modifier.height(12.dp))
        }

        if (state.pendingCount > 0) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer),
            ) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.CloudUpload, contentDescription = null,
                        tint = MaterialTheme.colorScheme.onTertiaryContainer)
                    Spacer(Modifier.width(8.dp))
                    Text("${state.pendingCount} photos queued for upload",
                        color = MaterialTheme.colorScheme.onTertiaryContainer,
                        style = MaterialTheme.typography.bodyMedium)
                }
            }
            Spacer(Modifier.height(12.dp))
        }

        // Action grid
        Text("Upload Photos", style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(8.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ActionCard(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.WbSunny,
                label = "Start of Day",
                subtitle = "SOD Photos",
                onClick = { viewModel.navigate(CfoNavScreen.SOD) },
            )
            ActionCard(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.NightShelter,
                label = "End of Day",
                subtitle = "EOD Photos",
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
                onClick = { viewModel.navigate(CfoNavScreen.SEALS) },
            )
            ActionCard(
                modifier = Modifier.weight(1f),
                icon = Icons.Default.History,
                label = "History",
                subtitle = "Past uploads",
                onClick = { viewModel.navigate(CfoNavScreen.HISTORY) },
            )
        }
    }
}

@Composable
private fun InfoChip(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(label, style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f))
        Text(value, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onPrimaryContainer)
    }
}

@Composable
private fun ActionCard(
    modifier: Modifier = Modifier,
    icon: ImageVector,
    label: String,
    subtitle: String,
    onClick: () -> Unit,
) {
    Card(modifier = modifier.clickable(onClick = onClick)) {
        Column(
            modifier = Modifier.padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(icon, contentDescription = label, modifier = Modifier.size(28.dp),
                tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(8.dp))
            Text(label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            Text(subtitle, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
