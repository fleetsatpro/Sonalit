package io.sonalit.guardian.ui.health

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

@Composable
fun DeviceHealthScreen(
    onBack: () -> Unit = {},
    viewModel: DeviceHealthViewModel = hiltViewModel(),
) {
    val context = LocalContext.current
    val healthState by viewModel.healthState.collectAsState()

    LaunchedEffect(Unit) { viewModel.refresh(context) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Device Health") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { HeaderCard("Power & Storage") }
            item { MetricCard("Battery Level", "${healthState.batteryLevel}%", icon = Icons.Default.BatteryFull) }
            item { MetricCard("Battery Health", healthState.batteryHealth, icon = Icons.Default.Favorite) }
            item { MetricCard("Charging", if (healthState.isCharging) "Yes" else "No", icon = Icons.Default.Power) }
            item { MetricCard("Internal Storage Free", healthState.storageFree, icon = Icons.Default.Storage) }

            item { HeaderCard("Connectivity & Location") }
            item { MetricCard("GPS Satellites", "${healthState.gpsSatellites}", icon = Icons.Default.GpsFixed) }
            item { MetricCard("GPS Accuracy", healthState.gpsAccuracy, icon = Icons.Default.GpsFixed) }
            item { MetricCard("Network Type", healthState.networkType, icon = Icons.Default.SignalWifi4Bar) }

            item { HeaderCard("Sensors & Peripherals") }
            item { MetricCard("Camera Status", healthState.cameraStatus, icon = Icons.Default.Camera) }
            item { MetricCard("Microphone Level", healthState.micLevel, icon = Icons.Default.Mic) }
            item { MetricCard("Background Service", healthState.serviceRunning, icon = Icons.Default.Settings) }

            item { HeaderCard("Permissions") }
            items(healthState.permissions) { perm ->
                PermissionRow(perm.name, perm.granted)
            }

            item {
                Button(
                    onClick = { viewModel.runFullDiagnostic(context) },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !healthState.loading,
                ) {
                    Text(if (healthState.loading) "Running…" else "Run Full Diagnostic")
                }
            }
            item {
                OutlinedButton(
                    onClick = { viewModel.shareReport(context) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Share Diagnostic Report")
                }
            }
        }
    }
}

@Composable
fun HeaderCard(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.padding(top = 8.dp, bottom = 4.dp),
    )
}

@Composable
fun MetricCard(label: String, value: String, icon: ImageVector) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(16.dp).fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Spacer(modifier = Modifier.width(12.dp))
            Text(text = label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            Text(text = value, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
fun PermissionRow(permission: String, granted: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val icon = if (granted) Icons.Default.Check else Icons.Default.Close
        Icon(icon, contentDescription = null, tint = if (granted) Color(0xFF4CAF50) else Color(0xFFF44336))
        Spacer(modifier = Modifier.width(8.dp))
        Text(text = permission, modifier = Modifier.weight(1f))
    }
}
