package io.sonalit.guardian.ui.cfo

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable
fun CfoScreen(onPhotoClick: () -> Unit = {}) {
    var pin by remember { mutableStateOf("") }
    var loggedIn by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("CFO Portal", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(16.dp))
        if (!loggedIn) {
            OutlinedTextField(
                value = pin, onValueChange = { pin = it },
                label = { Text("PIN") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true, modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = { loading = true; loggedIn = true; loading = false },
                enabled = pin.isNotBlank() && !loading,
                modifier = Modifier.fillMaxWidth(),
            ) { if (loading) CircularProgressIndicator(Modifier.size(20.dp)) else Text("Login") }
        } else {
            Text("Convoy Context", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            Text("Active convoy data loaded", style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(16.dp))
            OutlinedButton(onClick = onPhotoClick, modifier = Modifier.fillMaxWidth()) {
                Text("Upload Photo")
            }
        }
    }
}
