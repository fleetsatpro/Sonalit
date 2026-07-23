package io.sonalit.guardian.ui.home

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.MonitorHeart
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.sonalit.guardian.BuildConfig
import io.sonalit.guardian.NavDestination
import io.sonalit.guardian.ui.health.DeviceHealthScreen
import io.sonalit.guardian.ui.panic.PanicButtonScreen
import java.util.Locale

// ── Glass design tokens ───────────────────────────────────────────────────────
// GuardianTheme is always dark (see ui/theme/GuardianTheme.kt) — these mirror
// the app's own fixed palette rather than MaterialTheme.colorScheme, matching
// the signed-off Home mockup's "app-*" tokens. Real backdrop blur (Haze) is
// wired into the build but not yet applied to these cards — see PR notes.
private object Glass {
    val accent = Color(0xFFFFA24B)
    val accentText = Color(0xFF241202)
    val success = Color(0xFF3DDC97)
    val warn = Color(0xFFF2C94C)
    val danger = Color(0xFFFF6E6E)
    val fillTop = Color.White.copy(alpha = 0.14f)
    val fillBottom = Color.White.copy(alpha = 0.045f)
    val border = Color.White.copy(alpha = 0.16f)
    val textMuted = Color.White.copy(alpha = 0.55f)
}

private fun Modifier.glassCard(shape: Shape = RoundedCornerShape(16.dp)): Modifier = this
    .clip(shape)
    .background(Brush.verticalGradient(listOf(Glass.fillTop, Glass.fillBottom)))
    .border(1.dp, Glass.border, shape)

/** Ambient gradient + soft glows behind every glass card — flat single-tone
 *  dark reads as plain grey once cards are translucent, this gives the glass
 *  something to sit on. Blur is core Compose (no new dependency); it's a
 *  no-op below API 31, degrading to sharp-edged glows rather than crashing. */
@Composable
private fun HomeBackdrop(content: @Composable BoxScope.() -> Unit) {
    Box(Modifier.fillMaxSize()) {
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.linearGradient(listOf(Color(0xFF0A0E18), Color(0xFF121A2C), Color(0xFF0B0F1A)))
                )
        )
        Box(
            Modifier
                .align(Alignment.TopStart)
                .offset(x = (-70).dp, y = (-50).dp)
                .size(240.dp)
                .blur(90.dp)
                .background(Glass.accent.copy(alpha = 0.30f), CircleShape)
        )
        Box(
            Modifier
                .align(Alignment.TopEnd)
                .offset(x = 70.dp, y = 60.dp)
                .size(220.dp)
                .blur(90.dp)
                .background(Color(0xFF40C4FF).copy(alpha = 0.22f), CircleShape)
        )
        content()
    }
}

@Composable
fun HomeScreen(
    onNavigate: (NavDestination) -> Unit = {},
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var showDeviceHealth by remember { mutableStateOf(false) }

    if (showDeviceHealth) {
        DeviceHealthScreen(onBack = { showDeviceHealth = false })
        return
    }

    HomeBackdrop {
        Column(
            modifier = Modifier.fillMaxSize().padding(16.dp).verticalScroll(rememberScrollState()),
        ) {
            Text("Guardian Status", style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(16.dp))

            if (state.isEnrolledDevice) {
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
                StatusCard(label = "Last Heartbeat", value = fmtAge(state.lastHeartbeatAt), isGood = state.heartbeatState == SignalState.GOOD)
                Spacer(Modifier.height(8.dp))
                StatusCard(
                    label = "GPS",
                    value = when (state.gpsState) {
                        SignalState.GOOD -> "Syncing · last sent ${fmtAge(state.lastGpsSyncAt)}"
                        SignalState.STALE -> if (state.unsyncedFixCount > 0) {
                            "Recording but not syncing · ${state.unsyncedFixCount} queued"
                        } else {
                            "Not syncing · last sent ${fmtAge(state.lastGpsSyncAt)}"
                        }
                        SignalState.UNKNOWN -> "No fix yet"
                    },
                    isGood = state.gpsState == SignalState.GOOD,
                )
            } else {
                // CFO-only accounts auto-provision a device record server-side but never
                // run device enrollment on this phone, so there's no GuardianService/
                // heartbeat to report on — showing that as a red "failure" would be
                // misleading, so say what's actually true instead.
                StatusCard(label = "Account", value = "CFO — not a monitored device", isGood = true)
            }

            Spacer(Modifier.height(24.dp))
            ConvoyCard(inConvoy = state.inConvoy, convoyCode = state.convoyCode, members = state.convoyMembers)

            Spacer(Modifier.height(28.dp))
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("Hold for 3 seconds to arm", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(8.dp))
                PanicButtonScreen()
                Spacer(Modifier.height(8.dp))
                Text(
                    "Sends a silent SOS with your last known location to dispatch.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Glass.textMuted,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(14.dp))
                CallDispatchButton(phoneNumber = state.dispatchPhoneNumber)
            }

            Spacer(Modifier.height(28.dp))
            RecentActivityCard(items = state.recentActivity)

            Spacer(Modifier.height(28.dp))
            DispatchInboxCard(
                messages = state.dispatchMessages,
                unreadCount = state.unreadDispatchCount,
                onPlay = { msg -> msg.voiceUrl?.let { viewModel.replayVoiceMessage(msg.id, it) } },
                onTapText = { msg -> viewModel.markMessageRead(msg.id) },
            )

            Spacer(Modifier.height(28.dp))
            VoiceNoteRecorderCard(
                isRecording = state.isRecordingVoiceNote,
                elapsedMs = state.voiceNoteElapsedMs,
                sendState = state.voiceNoteSendState,
                onStart = viewModel::startVoiceNote,
                onStop = viewModel::stopVoiceNote,
            )

            Spacer(Modifier.height(28.dp))
            Text("Quick Actions", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
                QuickActionCard(
                    icon = Icons.Default.Person,
                    label = "CFO Dashboard",
                    modifier = Modifier.weight(1f),
                    onClick = { onNavigate(NavDestination.Cfo) },
                )
                QuickActionCard(
                    icon = Icons.Default.Settings,
                    label = "Settings",
                    modifier = Modifier.weight(1f),
                    onClick = { onNavigate(NavDestination.Settings) },
                )
            }
            Spacer(Modifier.height(12.dp))
            QuickActionCard(
                icon = Icons.Default.MonitorHeart,
                label = "Device Health",
                modifier = Modifier.fillMaxWidth(),
                onClick = { showDeviceHealth = true },
            )

            Spacer(Modifier.height(24.dp))
            Text(
                "Sonalit Guardian ${BuildConfig.VERSION_NAME}",
                style = MaterialTheme.typography.bodySmall,
                color = Glass.textMuted,
            )
        }
    }
}

// ── My Convoy ──────────────────────────────────────────────────────────────────

@Composable
private fun ConvoyCard(inConvoy: Boolean, convoyCode: String?, members: List<ConvoyMemberUi>) {
    SectionLabel("My Convoy")
    if (!inConvoy) {
        EmptyGlassNote(
            icon = Icons.Default.Groups,
            title = "Not currently in a convoy",
            subtitle = "Join a convoy code in Settings to see teammates here.",
        )
        return
    }
    Box(Modifier.fillMaxWidth().glassCard()) {
        Column(Modifier.padding(13.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(6.dp).background(Glass.success, CircleShape))
                    Spacer(Modifier.width(7.dp))
                    Text("${members.size} nearby", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium)
                }
                convoyCode?.let {
                    Text(it, style = MaterialTheme.typography.labelSmall, color = Glass.textMuted)
                }
            }
            if (members.isEmpty()) {
                Spacer(Modifier.height(6.dp))
                Text("No teammates nearby right now.", style = MaterialTheme.typography.bodySmall, color = Glass.textMuted)
            } else {
                Spacer(Modifier.height(6.dp))
                members.forEach { ConvoyMemberRow(it) }
            }
        }
    }
}

@Composable
private fun ConvoyMemberRow(member: ConvoyMemberUi) {
    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .size(26.dp)
                .clip(CircleShape)
                .background(Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.26f), Color.White.copy(alpha = 0.08f))))
                .border(1.dp, Color.White.copy(alpha = 0.2f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(initials(member.name), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(9.dp))
        Column(Modifier.weight(1f)) {
            Text(member.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            Text(
                listOfNotNull(member.distanceKm?.let { fmtDistance(it) }, member.lastSeenAt?.let { fmtAge(it) })
                    .joinToString(" · "),
                style = MaterialTheme.typography.labelSmall,
                color = Glass.textMuted,
            )
        }
        Box(Modifier.size(7.dp).background(if (member.stale) Glass.warn else Glass.success, CircleShape))
    }
}

private fun initials(name: String): String =
    name.trim().split(" ").filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() }.ifBlank { "?" }

private fun fmtDistance(km: Double): String = when {
    km < 1 -> "${(km * 1000).toInt()} m"
    else -> String.format(Locale.US, "%.1f km", km)
}

// ── Panic-section extras ──────────────────────────────────────────────────────

@Composable
private fun CallDispatchButton(phoneNumber: String?) {
    val context = LocalContext.current
    val enabled = phoneNumber != null
    val tint = if (enabled) Glass.accent else Color.White.copy(alpha = 0.35f)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(
                Brush.verticalGradient(
                    listOf(Glass.accent.copy(alpha = if (enabled) 0.20f else 0.07f), Glass.accent.copy(alpha = if (enabled) 0.06f else 0.02f))
                )
            )
            .border(BorderStroke(1.dp, tint.copy(alpha = if (enabled) 0.55f else 0.25f)), RoundedCornerShape(12.dp))
            .clickable(enabled = enabled) {
                phoneNumber?.let { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$it"))) }
            }
            .padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Default.Call, contentDescription = null, tint = tint, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text(
            if (enabled) "Call Dispatch" else "Call Dispatch — not configured",
            color = tint, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium,
        )
    }
}

// ── Recent Activity ────────────────────────────────────────────────────────────

@Composable
private fun RecentActivityCard(items: List<ActivityItem>) {
    SectionLabel("Recent Activity")
    if (items.isEmpty()) {
        EmptyGlassNote(
            icon = Icons.Default.CheckCircle,
            title = "No recent activity",
            subtitle = "SOS events and health alerts will show up here.",
        )
        return
    }
    Box(Modifier.fillMaxWidth().glassCard()) {
        Column(Modifier.padding(13.dp)) {
            items.forEachIndexed { index, item ->
                if (index > 0) HorizontalDivider(color = Color.White.copy(alpha = 0.08f), thickness = 0.5.dp)
                val ok = item.severity == "ok"
                Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.Top) {
                    Box(
                        modifier = Modifier.size(22.dp).clip(RoundedCornerShape(7.dp))
                            .background((if (ok) Glass.success else Glass.warn).copy(alpha = 0.16f)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            if (ok) Icons.Default.CheckCircle else Icons.Default.Warning,
                            contentDescription = null, tint = if (ok) Glass.success else Glass.warn,
                            modifier = Modifier.size(13.dp),
                        )
                    }
                    Spacer(Modifier.width(9.dp))
                    Column {
                        Text(item.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                        Text(fmtAge(item.occurredAt), style = MaterialTheme.typography.labelSmall, color = Glass.textMuted)
                    }
                }
            }
        }
    }
}

// ── Dispatch inbox ─────────────────────────────────────────────────────────────

@Composable
private fun DispatchInboxCard(
    messages: List<DispatchMessageUi>,
    unreadCount: Int,
    onPlay: (DispatchMessageUi) -> Unit,
    onTapText: (DispatchMessageUi) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        SectionLabel("Messages from Dispatch", modifier = Modifier.weight(1f))
        if (unreadCount > 0) {
            Box(
                modifier = Modifier.clip(RoundedCornerShape(100)).background(Glass.accent)
                    .padding(horizontal = 8.dp, vertical = 3.dp),
            ) {
                Text(
                    "$unreadCount NEW", color = Glass.accentText,
                    style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Black,
                )
            }
        }
    }
    Spacer(Modifier.height(8.dp))
    if (messages.isEmpty()) {
        EmptyGlassNote(
            icon = Icons.Default.Forum,
            title = "No messages yet",
            subtitle = "Ops messages and voice notes will appear here.",
        )
        return
    }
    Box(Modifier.fillMaxWidth().glassCard()) {
        Column(Modifier.padding(13.dp)) {
            messages.forEachIndexed { index, msg ->
                if (index > 0) HorizontalDivider(color = Color.White.copy(alpha = 0.08f), thickness = 0.5.dp)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(enabled = msg.kind != "voice") { onTapText(msg) }
                        .padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        modifier = Modifier.size(28.dp).clip(RoundedCornerShape(9.dp))
                            .background(Brush.verticalGradient(listOf(Color.White.copy(alpha = 0.2f), Color.White.copy(alpha = 0.05f))))
                            .border(1.dp, Color.White.copy(alpha = 0.16f), RoundedCornerShape(9.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            if (msg.kind == "voice") Icons.Default.Mic else Icons.Default.Forum,
                            contentDescription = null, tint = Glass.accent, modifier = Modifier.size(13.dp),
                        )
                    }
                    Spacer(Modifier.width(9.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            if (msg.kind == "voice") "Voice message" else (msg.text ?: ""),
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = 1,
                        )
                        Text(fmtAge(msg.receivedAt), style = MaterialTheme.typography.labelSmall, color = Glass.textMuted)
                    }
                    if (msg.kind == "voice") {
                        Box(
                            modifier = Modifier
                                .size(26.dp)
                                .clip(CircleShape)
                                .background(Glass.accent)
                                .clickable { onPlay(msg) },
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(Icons.Default.PlayArrow, contentDescription = "Play", tint = Glass.accentText, modifier = Modifier.size(15.dp))
                        }
                    }
                }
            }
        }
    }
}

// ── Voice note to dispatch (reverse of the inbox above) ────────────────────────

@Composable
private fun VoiceNoteRecorderCard(
    isRecording: Boolean,
    elapsedMs: Long,
    sendState: VoiceNoteSendState,
    onStart: () -> Unit,
    onStop: (send: Boolean) -> Unit,
) {
    val context = LocalContext.current
    var micGranted by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        )
    }
    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted -> micGranted = granted; if (granted) onStart() }

    SectionLabel("Send a voice note to dispatch")
    Box(Modifier.fillMaxWidth().glassCard()) {
        Column(Modifier.padding(13.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            if (!isRecording) {
                Row(
                    modifier = Modifier
                        .clip(RoundedCornerShape(100))
                        .background(Glass.accent)
                        .clickable {
                            if (micGranted) onStart() else permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                        }
                        .padding(horizontal = 18.dp, vertical = 9.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Default.Mic, contentDescription = null, tint = Glass.accentText, modifier = Modifier.size(15.dp))
                    Spacer(Modifier.width(7.dp))
                    Text("Record", color = Glass.accentText, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(Glass.danger))
                    Spacer(Modifier.width(7.dp))
                    Text("${elapsedMs / 1000}s / 60s", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        modifier = Modifier.clip(RoundedCornerShape(100)).background(Glass.success)
                            .clickable { onStop(true) }.padding(horizontal = 16.dp, vertical = 8.dp),
                    ) { Text("Send", color = Glass.accentText, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium) }
                    Row(
                        modifier = Modifier.clip(RoundedCornerShape(100)).border(1.dp, Glass.border, RoundedCornerShape(100))
                            .clickable { onStop(false) }.padding(horizontal = 16.dp, vertical = 8.dp),
                    ) { Text("Cancel", color = Glass.textMuted, style = MaterialTheme.typography.labelMedium) }
                }
            }
            if (sendState != VoiceNoteSendState.IDLE) {
                Spacer(Modifier.height(8.dp))
                Text(
                    when (sendState) {
                        VoiceNoteSendState.SENDING -> "Sending…"
                        VoiceNoteSendState.DONE -> "Sent to dispatch"
                        VoiceNoteSendState.ERROR -> "Failed to send"
                        VoiceNoteSendState.IDLE -> ""
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = when (sendState) {
                        VoiceNoteSendState.DONE -> Glass.success
                        VoiceNoteSendState.ERROR -> Glass.danger
                        else -> Glass.textMuted
                    },
                )
            }
        }
    }
}

// ── Shared bits ────────────────────────────────────────────────────────────────

@Composable
private fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.Bold,
        color = Glass.textMuted,
        letterSpacing = 0.08.em,
        modifier = modifier.padding(bottom = 8.dp),
    )
}

@Composable
private fun EmptyGlassNote(icon: ImageVector, title: String, subtitle: String) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Color.White.copy(alpha = 0.035f))
            .border(1.dp, Color.White.copy(alpha = 0.14f), RoundedCornerShape(14.dp)),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(vertical = 18.dp, horizontal = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(icon, contentDescription = null, tint = Color.White.copy(alpha = 0.4f), modifier = Modifier.size(22.dp))
            Spacer(Modifier.height(6.dp))
            Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(2.dp))
            Text(subtitle, style = MaterialTheme.typography.labelSmall, color = Glass.textMuted, textAlign = TextAlign.Center)
        }
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
    Box(Modifier.fillMaxWidth().glassCard()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            Text(value, color = if (isGood) Glass.success else Glass.danger, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun QuickActionCard(
    icon: ImageVector,
    label: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(modifier = modifier.glassCard().clickable(onClick = onClick)) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(vertical = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(icon, contentDescription = null, tint = Glass.accent)
            Spacer(Modifier.height(8.dp))
            Text(label, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
