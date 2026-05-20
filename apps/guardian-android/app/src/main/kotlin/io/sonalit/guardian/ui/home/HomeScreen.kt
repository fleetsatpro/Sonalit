package io.sonalit.guardian.ui.home

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun HomeScreen(onPanicClick: () -> Unit = {}) {
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Guardian Status", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(16.dp))
        StatusCard(label = "Service", value = "Running", isGood = true)
        Spacer(Modifier.height(8.dp))
        StatusCard(label = "Last Heartbeat", value = "Just now", isGood = true)
        Spacer(Modifier.height(8.dp))
        StatusCard(label = "GPS", value = "Active", isGood = true)
        Spacer(Modifier.height(32.dp))
        Button(
            onClick = onPanicClick,
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
            modifier = Modifier.fillMaxWidth().height(64.dp),
        ) {
            Text("PANIC", style = MaterialTheme.typography.titleLarge)
        }
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
