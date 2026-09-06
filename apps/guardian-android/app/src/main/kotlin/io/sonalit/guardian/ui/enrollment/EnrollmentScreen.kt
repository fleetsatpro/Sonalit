package io.sonalit.guardian.ui.enrollment

import android.provider.Settings
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.HourglassEmpty
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

@Composable
fun EnrollmentScreen(
    onEnrolled: () -> Unit = {},
    viewModel: EnrollmentViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    var operatorCode by remember { mutableStateOf("") }

    LaunchedEffect(state) {
        if (state is EnrollUiState.Enrolled) onEnrolled()
    }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Guardian Enrollment", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(32.dp))

        when (val s = state) {
            is EnrollUiState.PendingApproval -> {
                Icon(Icons.Default.HourglassEmpty, contentDescription = null,
                    modifier = Modifier.size(64.dp), tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(16.dp))
                Text("Awaiting operator approval", style = MaterialTheme.typography.bodyLarge)
                Spacer(Modifier.height(8.dp))
                Text(
                    "Your dispatcher needs to approve this device. This screen will " +
                        "move on by itself the moment that happens — no need to reopen the app.",
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(16.dp))
                Text("Device ID: ${s.deviceUuid}", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(24.dp))
                TextButton(onClick = { viewModel.startOver() }) {
                    Text("Entered the wrong badge number? Start over")
                }
            }
            is EnrollUiState.Enrolled -> {
                Icon(Icons.Default.CheckCircle, contentDescription = null,
                    modifier = Modifier.size(64.dp), tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(16.dp))
                Text("Enrolled successfully", style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.primary)
            }
            is EnrollUiState.Error -> {
                Text(s.message, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center)
                Spacer(Modifier.height(16.dp))
                enrollForm(operatorCode, onCodeChange = { operatorCode = it }) {
                    val deviceId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
                    viewModel.enroll(deviceId, operatorCode, "integrity_token_placeholder")
                }
            }
            is EnrollUiState.Loading -> CircularProgressIndicator()
            else -> enrollForm(operatorCode, onCodeChange = { operatorCode = it }) {
                val deviceId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
                viewModel.enroll(deviceId, operatorCode, "integrity_token_placeholder")
            }
        }
    }
}

@Composable
private fun enrollForm(code: String, onCodeChange: (String) -> Unit, onEnroll: () -> Unit) {
    Text(
        "Enter the badge number your dispatcher gave you to link this phone to your officer profile.",
        style = MaterialTheme.typography.bodyMedium,
        textAlign = TextAlign.Center,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(16.dp))
    OutlinedTextField(value = code, onValueChange = onCodeChange,
        label = { Text("Badge Number") },
        placeholder = { Text("e.g. KPS-2024-001") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth())
    Spacer(Modifier.height(16.dp))
    Button(onClick = onEnroll, enabled = code.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
        Text("Enroll Device")
    }
}
