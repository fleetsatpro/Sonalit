package io.sonalit.guardian.ui.enrollment

import android.provider.Settings
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.HourglassEmpty
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
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

        when (state) {
            is EnrollUiState.PendingApproval -> {
                Icon(Icons.Default.HourglassEmpty, contentDescription = null,
                    modifier = Modifier.size(64.dp), tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(16.dp))
                Text("Awaiting operator approval", style = MaterialTheme.typography.bodyLarge)
                Text("Device: ${(state as EnrollUiState.PendingApproval).deviceUuid}",
                    style = MaterialTheme.typography.bodySmall)
            }
            is EnrollUiState.Enrolled -> {
                Text("Enrolled successfully", style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.primary)
            }
            is EnrollUiState.Error -> {
                Text((state as EnrollUiState.Error).message,
                    color = MaterialTheme.colorScheme.error)
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
    OutlinedTextField(value = code, onValueChange = onCodeChange,
        label = { Text("Operator Code") }, singleLine = true,
        modifier = Modifier.fillMaxWidth())
    Spacer(Modifier.height(16.dp))
    Button(onClick = onEnroll, enabled = code.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
        Text("Enroll Device")
    }
}
