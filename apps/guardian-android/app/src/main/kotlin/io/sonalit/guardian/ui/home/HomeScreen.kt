package io.sonalit.guardian.ui.home

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MonitorHeart
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.sonalit.guardian.BuildConfig
import io.sonalit.guardian.NavDestination
import io.sonalit.guardian.ui.health.DeviceHealthScreen
import io.sonalit.guardian.ui.panic.PanicButtonScreen

@Composable
fun HomeScreen(
    onNavigate: (NavDestination) -> Unit = {},
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var showDeviceHealth by remember { mutableStateOf(false) }

    if (showDeviceHealth) {
        DeviceHealthScreen(onBack = { showDeviceHealth = false })
        return
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
    ) {
        Text("Guardian Status", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(16.dp))

        if (state.isEnrolledDevice) {
            StatusCard(
                label = "Service",
                value = when (state.serviceState) {
                    SignalState.GOOD -> "Running"
                    SignalState.STALE -> "Not responding"
                    SignalState.UNKNOWN -> "Not started"
                },
                isGood = state.serviceState == SignalState.GOOD,
            )
            Spacer(Modifier.height(8.dp))
            StatusCard(label = "Last Heartbeat", value = fmtAge(state.lastHeartbeatAt), isGood = state.heartbeatState == SignalState.GOOD)
            Spacer(Modifier.height(8.dp))
            StatusCard(
                label = "GPS",
                value = when (state.gpsState) {
                    SignalState.GOOD -> "Syncing · last sent ${fmtAge(state.lastGpsSyncAt)}"
                    SignalState.STALE -> if (state.unsyncedFixCount > 0) {
                        "Recording but not syncing · ${state.unsyncedFixCount} queued"
                    } else {
                        "Not syncing · last sent ${fmtAge(state.lastGpsSyncAt)}"
                    }
                    SignalState.UNKNOWN -> "No fix yet"
                },
                isGood = state.gpsState == SignalState.GOOD,
            )
        } else {
            // CFO-only accounts auto-provision a device record server-side but never
            // run device enrollment on this phone, so there's no GuardianService/
            // heartbeat to report on — showing that as a red "failure" would be
            // misleading, so say what's actually true instead.
            StatusCard(label = "Account", value = "CFO — not a monitored device", isGood = true)
        }

        Spacer(Modifier.height(32.dp))
        Text("Hold for 3 seconds to arm", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(8.dp))
        PanicButtonScreen()
        Spacer(Modifier.height(8.dp))
        Text(
            "Sends a silent SOS with your last known location to dispatch.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(Modifier.height(32.dp))
        Text("Quick Actions", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
            QuickActionCard(
                icon = Icons.Default.Person,
                label = "CFO Dashboard",
                modifier = Modifier.weight(1f),
                onClick = { onNavigate(NavDestination.Cfo) },
            )
            QuickActionCard(
                icon = Icons.Default.Settings,
                label = "Settings",
                modifier = Modifier.weight(1f),
                onClick = { onNavigate(NavDestination.Settings) },
            )
        }
        Spacer(Modifier.height(12.dp))
        QuickActionCard(
            icon = Icons.Default.MonitorHeart,
            label = "Device Health",
            modifier = Modifier.fillMaxWidth(),
            onClick = { showDeviceHealth = true },
        )

        Spacer(Modifier.height(24.dp))
        Text(
            "Sonalit Guardian ${BuildConfig.VERSION_NAME}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private fun fmtAge(ts: Long?): String {
    if (ts == null) return "Never"
    val seconds = (System.currentTimeMillis() - ts) / 1000
    return when {
        seconds < 5 -> "Just now"
        seconds < 60 -> "${seconds}s ago"
        seconds < 3600 -> "${seconds / 60}m ago"
        seconds < 86400 -> "${seconds / 3600}h ago"
        else -> "${seconds / 86400}d ago"
    }
}

@Composable
private fun StatusCard(label: String, value: String, isGood: Boolean) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            Text(value, color = if (isGood) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
        }
    }
}

@Composable
private fun QuickActionCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Card(modifier = modifier, onClick = onClick) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(vertical = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(8.dp))
            Text(label, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
