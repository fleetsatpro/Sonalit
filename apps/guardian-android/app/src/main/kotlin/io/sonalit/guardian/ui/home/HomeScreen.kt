package io.sonalit.guardian.ui.home

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun HomeScreen(
    onPanicClick: () -> Unit = {},
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Guardian Status", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(16.dp))
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
        StatusCard(label = "Last Heartbeat", value = fmtAge(state.lastHeartbeatAt), isGood = state.serviceState == SignalState.GOOD)
        Spacer(Modifier.height(8.dp))
        StatusCard(
            label = "GPS",
            value = when (state.gpsState) {
                SignalState.GOOD -> "Active · ${fmtAge(state.lastGpsFixAt)}"
                SignalState.STALE -> "Stale · ${fmtAge(state.lastGpsFixAt)}"
                SignalState.UNKNOWN -> "No fix yet"
            },
            isGood = state.gpsState == SignalState.GOOD,
        )
        Spacer(Modifier.height(32.dp))
        Button(
            onClick = onPanicClick,
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
            modifier = Modifier.fillMaxWidth().height(64.dp),
        ) {
            Text("PANIC", style = MaterialTheme.typography.titleLarge)
        }
        Spacer(Modifier.height(8.dp))
        Text(
            "Sends a silent SOS with your last known location to dispatch.",
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
