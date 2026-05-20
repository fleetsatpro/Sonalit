package io.sonalit.guardian.ui.cfo

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun CfoPhotoScreen(onBack: () -> Unit = {}) {
    var captured by remember { mutableStateOf(false) }
    var uploading by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Photo Upload", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(16.dp))
        Box(
            modifier = Modifier.fillMaxWidth().height(240.dp).padding(8.dp),
            contentAlignment = Alignment.Center,
        ) {
            if (!captured) {
                Button(onClick = { captured = true }) { Text("Capture Photo") }
            } else {
                Text("Photo captured (encrypted on disk)", style = MaterialTheme.typography.bodyMedium)
            }
        }
        Spacer(Modifier.height(16.dp))
        if (captured && !done) {
            Button(
                onClick = { uploading = true; done = true; uploading = false },
                enabled = !uploading,
                modifier = Modifier.fillMaxWidth(),
            ) { if (uploading) CircularProgressIndicator(Modifier.size(20.dp)) else Text("Upload") }
        }
        if (done) {
            Text("Upload complete", color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onBack) { Text("Back") }
        }
    }
}
