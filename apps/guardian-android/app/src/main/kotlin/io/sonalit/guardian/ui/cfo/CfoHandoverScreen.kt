package io.sonalit.guardian.ui.cfo

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import java.io.File

/**
 * Local-consignment convoys only: the CFO photographs the signed handover
 * form and submits it directly, no handover officer involved. Reuses
 * CfoPhotoScreen's CameraCapture composable for a consistent capture UX.
 * Submitting is the terminal action — a successful commit flips convoy_ended
 * in the ViewModel, and this screen bounces back to the dashboard to show it.
 */
@Composable
fun CfoHandoverScreen(viewModel: CfoViewModel, onBack: () -> Unit) {
    val state by viewModel.state.collectAsState()
    var capturedFile by remember { mutableStateOf<File?>(null) }
    var notes by remember { mutableStateOf("") }

    LaunchedEffect(state.convoyEnded) {
        if (state.convoyEnded) onBack()
    }

    Column(Modifier.fillMaxSize()) {
        Surface(tonalElevation = 2.dp) {
            Row(
                Modifier.padding(horizontal = 16.dp, vertical = 10.dp).fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                }
                Column(Modifier.weight(1f)) {
                    Text("Handover Form", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(
                        "Photograph the signed handover form to end this convoy",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        Box(modifier = Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
            if (capturedFile == null) {
                CameraCapture(onImageCaptured = { capturedFile = it }, modifier = Modifier.fillMaxSize())
            } else {
                AsyncImage(
                    model = capturedFile,
                    contentDescription = "Captured handover form",
                    modifier = Modifier.fillMaxSize(),
                )
                FloatingActionButton(
                    onClick = { capturedFile = null },
                    containerColor = MaterialTheme.colorScheme.errorContainer,
                    modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp),
                ) {
                    Icon(Icons.Default.Refresh, contentDescription = "Retake")
                }
            }
        }

        Surface(tonalElevation = 3.dp) {
            Column(Modifier.padding(16.dp)) {
                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("Notes (optional)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(10.dp))

                if (state.handoverError != null) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Warning, contentDescription = null,
                            tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(state.handoverError!!, color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall)
                    }
                    Spacer(Modifier.height(8.dp))
                }

                Button(
                    onClick = {
                        capturedFile?.let { file -> viewModel.uploadHandover(file, notes.ifBlank { null }) }
                    },
                    enabled = capturedFile != null && !state.handoverUploading,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)),
                ) {
                    if (state.handoverUploading) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    } else {
                        Text("Submit Handover")
                    }
                }
            }
        }
    }
}
