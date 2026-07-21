package io.sonalit.guardian.ui.home

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import io.sonalit.guardian.data.local.ActivityEventDao
import io.sonalit.guardian.data.local.ActivityEventEntity
import io.sonalit.guardian.data.local.AppDatabase
import io.sonalit.guardian.data.local.DispatchMessageDao
import io.sonalit.guardian.data.local.DispatchMessageEntity
import io.sonalit.guardian.data.local.HeartbeatStatusStore
import io.sonalit.guardian.data.local.SyncStatusStore
import io.sonalit.guardian.data.local.VoiceTriggerStore
import io.sonalit.guardian.data.remote.ConvoyMember
import io.sonalit.guardian.data.remote.GuardianApi
import io.sonalit.guardian.service.CommandExecutor
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import javax.inject.Inject
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

enum class SignalState { GOOD, STALE, UNKNOWN }
enum class VoiceNoteSendState { IDLE, SENDING, DONE, ERROR }

// Matches the 60s cap the dispatch-side web recorder already enforces
// (DetailCard.tsx MAX_VOICE_MS) and the backend's raw-body route.
private const val MAX_VOICE_NOTE_MS = 60_000L

data class ConvoyMemberUi(
    val id: String,
    val name: String,
    val distanceKm: Double?,
    val lastSeenAt: Long?,
    val stale: Boolean,
)

data class ActivityItem(
    val title: String,
    val detail: String?,
    val severity: String,
    val occurredAt: Long,
)

data class DispatchMessageUi(
    val id: String,
    val kind: String,
    val text: String?,
    val voiceUrl: String?,
    val receivedAt: Long,
)

data class HomeUiState(
    val isEnrolledDevice: Boolean = false,
    val lastHeartbeatAt: Long? = null,
    val lastGpsFixAt: Long? = null,
    val lastGpsSyncAt: Long? = null,
    val unsyncedFixCount: Int = 0,
    val serviceState: SignalState = SignalState.UNKNOWN,
    val heartbeatState: SignalState = SignalState.UNKNOWN,
    val gpsState: SignalState = SignalState.UNKNOWN,
    val inConvoy: Boolean = false,
    val convoyCode: String? = null,
    val convoyMembers: List<ConvoyMemberUi> = emptyList(),
    val recentActivity: List<ActivityItem> = emptyList(),
    val dispatchMessages: List<DispatchMessageUi> = emptyList(),
    val unreadDispatchCount: Int = 0,
    val voiceTriggerArmed: Boolean = false,
    val dispatchPhoneNumber: String? = null,
    val isRecordingVoiceNote: Boolean = false,
    val voiceNoteElapsedMs: Long = 0,
    val voiceNoteSendState: VoiceNoteSendState = VoiceNoteSendState.IDLE,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val db: AppDatabase,
    private val statusStore: HeartbeatStatusStore,
    private val syncStatusStore: SyncStatusStore,
    private val api: GuardianApi,
    private val activityEventDao: ActivityEventDao,
    private val dispatchMessageDao: DispatchMessageDao,
    private val voiceTriggerStore: VoiceTriggerStore,
    private val commandExecutor: CommandExecutor,
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    private val prefs by lazy {
        val masterKey = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context, "guardian_prefs", masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    // Previous poll's signal states — lets refresh() notice a GOOD→STALE (or
    // back) transition and log it to Recent Activity, instead of only ever
    // showing the live value like the three status cards above already do.
    private var prevServiceState = SignalState.UNKNOWN
    private var prevHeartbeatState = SignalState.UNKNOWN
    private var prevGpsState = SignalState.UNKNOWN

    init {
        viewModelScope.launch {
            while (true) {
                refresh()
                delay(15_000)
            }
        }
        viewModelScope.launch {
            while (true) {
                refreshConvoyAndConfig()
                delay(30_000)
            }
        }
        viewModelScope.launch {
            combine(dispatchMessageDao.recent(5), dispatchMessageDao.unreadCount()) { messages, unread ->
                messages.map {
                    DispatchMessageUi(it.id, it.kind, it.text, it.voiceUrl, it.receivedAt)
                } to unread
            }.collect { (messages, unread) ->
                _uiState.update { it.copy(dispatchMessages = messages, unreadDispatchCount = unread) }
            }
        }
        viewModelScope.launch {
            activityEventDao.recent(5).collect { events ->
                _uiState.update {
                    it.copy(recentActivity = events.map { e -> ActivityItem(e.title, e.detail, e.severity, e.occurredAt) })
                }
            }
        }
    }

    /** Marks one dispatch message as seen — called when the officer taps it
     *  (or its play button), not in bulk, so the unread badge only clears for
     *  messages actually looked at. */
    fun markMessageRead(id: String) {
        viewModelScope.launch { dispatchMessageDao.markRead(id) }
    }

    /** Re-plays a voice note from the Home inbox and marks it read. */
    fun replayVoiceMessage(id: String, url: String) {
        viewModelScope.launch {
            commandExecutor.replayVoiceMessage(url)
            dispatchMessageDao.markRead(id)
        }
    }

    // ── Voice note to dispatch (reverse of the inbox above — officer records,
    // dispatch listens on the Live Fleet detail card) ──────────────────────────
    private var voiceRecorder: MediaRecorder? = null
    private var voiceNoteFile: File? = null
    private var voiceNoteStartMs: Long = 0
    private var voiceNoteTickerJob: Job? = null

    fun startVoiceNote() {
        if (voiceRecorder != null) return
        val file = File(context.cacheDir, "voice_note_${System.currentTimeMillis()}.m4a")
        @Suppress("DEPRECATION")
        val rec = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else MediaRecorder()
        try {
            rec.setAudioSource(MediaRecorder.AudioSource.MIC)
            rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            rec.setAudioEncodingBitRate(64_000)
            rec.setAudioSamplingRate(44_100)
            rec.setOutputFile(file.absolutePath)
            rec.prepare()
            rec.start()
        } catch (e: Exception) {
            rec.release()
            _uiState.update { it.copy(voiceNoteSendState = VoiceNoteSendState.ERROR) }
            return
        }
        voiceRecorder = rec
        voiceNoteFile = file
        voiceNoteStartMs = System.currentTimeMillis()
        _uiState.update { it.copy(isRecordingVoiceNote = true, voiceNoteElapsedMs = 0, voiceNoteSendState = VoiceNoteSendState.IDLE) }
        voiceNoteTickerJob = viewModelScope.launch {
            while (true) {
                delay(200)
                val elapsed = System.currentTimeMillis() - voiceNoteStartMs
                _uiState.update { it.copy(voiceNoteElapsedMs = elapsed) }
                if (elapsed >= MAX_VOICE_NOTE_MS) { stopVoiceNote(send = true); break }
            }
        }
    }

    /** [send]=false discards the clip (officer cancelled); true uploads it. */
    fun stopVoiceNote(send: Boolean) {
        voiceNoteTickerJob?.cancel()
        voiceNoteTickerJob = null
        val rec = voiceRecorder ?: return
        val file = voiceNoteFile
        val durationMs = (System.currentTimeMillis() - voiceNoteStartMs).coerceAtMost(MAX_VOICE_NOTE_MS)
        runCatching { rec.stop() }
        rec.release()
        voiceRecorder = null
        _uiState.update { it.copy(isRecordingVoiceNote = false) }

        if (!send || file == null) {
            file?.delete()
            voiceNoteFile = null
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(voiceNoteSendState = VoiceNoteSendState.SENDING) }
            val result = runCatching {
                val fix = db.gpsFixDao().getLatest() // tag the note with the officer's live location
                val body = file.readBytes().toRequestBody("audio/mp4".toMediaTypeOrNull())
                api.uploadVoiceMessage(body, durationMs.toInt(), fix?.lat, fix?.lon)
            }
            file.delete()
            voiceNoteFile = null
            _uiState.update {
                it.copy(voiceNoteSendState = if (result.isSuccess) VoiceNoteSendState.DONE else VoiceNoteSendState.ERROR)
            }
            delay(3000)
            _uiState.update { it.copy(voiceNoteSendState = VoiceNoteSendState.IDLE) }
        }
    }

    override fun onCleared() {
        super.onCleared()
        // Discard, don't upload, a clip still recording when the screen goes away.
        if (voiceRecorder != null) stopVoiceNote(send = false)
    }

    private suspend fun refreshConvoyAndConfig() {
        runCatching { api.convoyStatus() }.onSuccess { resp ->
            val ownFix = db.gpsFixDao().getLatest()
            val now = System.currentTimeMillis()
            _uiState.update {
                it.copy(
                    inConvoy = resp.in_convoy,
                    convoyCode = resp.convoy_code,
                    convoyMembers = resp.members.map { m -> m.toUi(ownFix?.lat, ownFix?.lon, now) },
                )
            }
        }
        // Config is org-wide and rarely changes — best-effort, keep the last
        // known value on failure rather than blanking out Call Dispatch.
        runCatching { api.config() }.onSuccess { config ->
            val number = (config["dispatch_phone_number"] as? String)?.trim()?.takeIf { it.isNotBlank() }
            _uiState.update { it.copy(dispatchPhoneNumber = number) }
        }
    }

    private fun ConvoyMember.toUi(ownLat: Double?, ownLon: Double?, now: Long): ConvoyMemberUi {
        val lastSeenMs = parseIsoToMillis(last_seen)
        val distance = if (ownLat != null && ownLon != null && last_lat != null && last_lng != null) {
            haversineKm(ownLat, ownLon, last_lat, last_lng)
        } else null
        // "Stale" mirrors the 2-min local-fix threshold refresh() already uses
        // for this device's own GPS health card — same bar, same meaning.
        val stale = lastSeenMs == null || now - lastSeenMs > 2 * 60_000L
        return ConvoyMemberUi(id, name, distance, lastSeenMs, stale)
    }

    private suspend fun refresh() {
        val now = System.currentTimeMillis()
        val lastHeartbeat = statusStore.lastHeartbeatAt()
        val serviceAlive = statusStore.serviceAliveAt()
        val lastFix = db.gpsFixDao().getLatest()
        val lastSync = syncStatusStore.lastSyncAt()
        val unsyncedCount = db.gpsFixDao().countUnsynced()
        // A CFO-only login auto-provisions a guardian_devices row server-side but
        // never runs device enrollment on this phone, so HeartbeatWorker/
        // GuardianService are never scheduled here — "Service: Not started" is
        // then a correct read of an untracked account, not a failure, and the UI
        // should say so instead of showing it as broken.
        val isEnrolledDevice = prefs.getString("device_id", null) != null && prefs.getString("auth_token", null) != null
        // GuardianService buffering a fix locally every 30s says nothing about
        // whether that data ever reaches the server — it kept doing exactly
        // that the whole time the sync endpoint was silently 404ing (see the
        // telemetry/batch fix). "GPS: Active" needs BOTH a recent local fix
        // AND a recent successful sync, not just the former.
        val localFixHealthy = classify(lastFix?.ts, now, staleAfterMs = 2 * 60_000L) == SignalState.GOOD
        // SyncWorker's real cadence is WorkManager's 15-min floor, so allow two
        // missed cycles plus backoff (~37 min) before calling sync unhealthy —
        // otherwise a single Doze-delayed cycle falsely reads as "not syncing".
        val syncHealthy = classify(lastSync, now, staleAfterMs = 37 * 60_000L) == SignalState.GOOD
        val gpsState = when {
            lastFix == null -> SignalState.UNKNOWN
            localFixHealthy && syncHealthy -> SignalState.GOOD
            else -> SignalState.STALE
        }
        val serviceState = classify(serviceAlive, now, staleAfterMs = 3 * 60_000L)
        val heartbeatState = classify(lastHeartbeat, now, staleAfterMs = 35 * 60_000L)

        recordHealthTransition("Service", prevServiceState, serviceState)
        recordHealthTransition("Heartbeat", prevHeartbeatState, heartbeatState)
        recordHealthTransition("GPS sync", prevGpsState, gpsState)
        prevServiceState = serviceState
        prevHeartbeatState = heartbeatState
        prevGpsState = gpsState

        _uiState.update {
            it.copy(
                isEnrolledDevice = isEnrolledDevice,
                lastHeartbeatAt = lastHeartbeat,
                lastGpsFixAt = lastFix?.ts,
                lastGpsSyncAt = lastSync,
                unsyncedFixCount = unsyncedCount,
                // "Service" reflects whether the on-device GuardianService is
                // actually alive right now. It writes a liveness tick every 60s,
                // so >3 min (three missed ticks) means it's genuinely dead —
                // unlike the old check, which read the ≤15-min network heartbeat
                // and therefore went falsely red for minutes every single cycle.
                serviceState = serviceState,
                // The network heartbeat can only run every ~15 min (WorkManager's
                // periodic floor), so it's only genuinely unhealthy after two
                // missed cycles (~35 min) plus retry backoff.
                heartbeatState = heartbeatState,
                gpsState = gpsState,
                voiceTriggerArmed = voiceTriggerStore.isEnabled(),
            )
        }
    }

    private fun classify(ts: Long?, now: Long, staleAfterMs: Long): SignalState = when {
        ts == null -> SignalState.UNKNOWN
        now - ts <= staleAfterMs -> SignalState.GOOD
        else -> SignalState.STALE
    }

    /** Logs a Recent Activity row the moment a signal flips GOOD↔STALE — never
     *  fires from/to UNKNOWN, since that's "no data yet" at startup, not a
     *  real transition worth surfacing. */
    private fun recordHealthTransition(label: String, old: SignalState, new: SignalState) {
        if (old == SignalState.UNKNOWN || old == new) return
        val event = when (new) {
            SignalState.STALE -> ActivityEventEntity(
                id = UUID.randomUUID().toString(), kind = "health", title = "$label delayed",
                detail = null, severity = "warn", occurredAt = System.currentTimeMillis(),
            )
            SignalState.GOOD -> ActivityEventEntity(
                id = UUID.randomUUID().toString(), kind = "health", title = "$label recovered",
                detail = null, severity = "ok", occurredAt = System.currentTimeMillis(),
            )
            SignalState.UNKNOWN -> return
        }
        viewModelScope.launch { activityEventDao.insert(event) }
    }
}

private fun parseIsoToMillis(ts: String?): Long? {
    if (ts.isNullOrBlank()) return null
    val patterns = listOf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'")
    for (pattern in patterns) {
        runCatching {
            val fmt = SimpleDateFormat(pattern, Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
            return fmt.parse(ts)?.time
        }
    }
    return null
}

private fun haversineKm(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
    val earthRadiusKm = 6371.0
    val dLat = Math.toRadians(lat2 - lat1)
    val dLon = Math.toRadians(lon2 - lon1)
    val a = sin(dLat / 2) * sin(dLat / 2) +
        cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2) * sin(dLon / 2)
    val c = 2 * atan2(sqrt(a), sqrt(1 - a))
    return earthRadiusKm * c
}
