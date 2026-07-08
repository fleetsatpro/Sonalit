package io.sonalit.guardian.ui.settings

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudSync
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import io.sonalit.guardian.BuildConfig
import io.sonalit.guardian.ui.cfo.CfoViewModel
import io.sonalit.guardian.worker.PendingPhotoUploadWorker

@Composable
fun SettingsScreen(cfoViewModel: CfoViewModel = hiltViewModel()) {
    val context = LocalContext.current
    val cfoState by cfoViewModel.state.collectAsState()

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Settings", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(20.dp))

        // CFO Account
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                SectionHeader(Icons.Default.Person, "CFO Account")
                Spacer(Modifier.height(12.dp))
                val user = cfoState.loggedInUser
                if (user != null) {
                    SettingRow("Name", user.name)
                    SettingRow("Email", user.email)
                    Spacer(Modifier.height(12.dp))
                    OutlinedButton(
                        onClick = { cfoViewModel.logout() },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    ) {
                        Icon(Icons.Default.Logout, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Sign Out")
                    }
                } else {
                    Text("Not signed in to the CFO module.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        Spacer(Modifier.height(16.dp))

        // Sync & Offline
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                SectionHeader(Icons.Default.CloudSync, "Sync & Offline")
                Spacer(Modifier.height(12.dp))
                SettingRow("Photos queued for upload", "${cfoState.pendingCount}")
                Spacer(Modifier.height(12.dp))
                OutlinedButton(
                    onClick = { PendingPhotoUploadWorker.retryNow(context) },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = cfoState.pendingCount > 0,
                ) {
                    Text("Retry Now")
                }
            }
        }
        Spacer(Modifier.height(16.dp))

        // About
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp)) {
                SectionHeader(Icons.Default.Info, "About")
                Spacer(Modifier.height(12.dp))
                SettingRow("App Version", BuildConfig.VERSION_NAME)
                SettingRow("API Endpoint", BuildConfig.API_BASE_URL)
                SettingRow("Build", if (BuildConfig.DEBUG) "Debug" else "Release")
            }
        }
    }
}

@Composable
private fun SectionHeader(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(8.dp))
        Text(title, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun SettingRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 5.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
    }
}
