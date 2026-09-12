package io.sonalit.guardian.ui.cfo

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

/**
 * Root CFO tab composable. Delegates to Login or Dashboard based on auth state.
 */
@Composable
fun CfoScreen(viewModel: CfoViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsState()

    when (state.screen) {
        CfoNavScreen.LOGIN -> CfoLoginScreen(viewModel = viewModel)
        CfoNavScreen.DASHBOARD -> CfoDashboardScreen(viewModel = viewModel)
        CfoNavScreen.SOD, CfoNavScreen.EOD -> CfoSodEodScreen(viewModel = viewModel)
        CfoNavScreen.SEALS -> CfoSealsScreen(viewModel = viewModel)
        CfoNavScreen.HISTORY -> CfoHistoryScreen(viewModel = viewModel)
        CfoNavScreen.HANDOVER -> CfoHandoverScreen(viewModel = viewModel, onBack = { viewModel.navigate(CfoNavScreen.DASHBOARD) })
        // Tracking activation gets its own ViewModel rather than growing
        // CfoViewModel: it owns an independent 15s poll and a QR token that
        // must never outlive the screen, so a separate lifecycle is the point.
        CfoNavScreen.TRACKING -> CfoTrackingScreen(onBack = { viewModel.navigate(CfoNavScreen.DASHBOARD) })
    }
}

// ── Login screen ──────────────────────────────────────────────────────────────

@Composable
fun CfoLoginScreen(viewModel: CfoViewModel) {
    val state by viewModel.state.collectAsState()
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            "CFO Guardian Login",
            style = MaterialTheme.typography.headlineSmall,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            "Sign in with your Sonalit CFO account",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(32.dp))

        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text("Email") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Email,
                imeAction = ImeAction.Next,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))

        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Password") },
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Password,
                imeAction = ImeAction.Done,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))

        if (state.loginError != null) {
            Text(
                state.loginError!!,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
        }

        Button(
            onClick = { viewModel.login(email, password) },
            enabled = email.isNotBlank() && password.isNotBlank() && !state.loginLoading,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (state.loginLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                )
            } else {
                Text("Sign In")
            }
        }
    }
}
