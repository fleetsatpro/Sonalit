package io.sonalit.guardian.ui.home

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import io.sonalit.guardian.data.local.AppDatabase
import io.sonalit.guardian.data.local.HeartbeatStatusStore
import io.sonalit.guardian.data.local.SyncStatusStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class SignalState { GOOD, STALE, UNKNOWN }

data class HomeUiState(
    val isEnrolledDevice: Boolean = false,
    val lastHeartbeatAt: Long? = null,
    val lastGpsFixAt: Long? = null,
    val lastGpsSyncAt: Long? = null,
    val unsyncedFixCount: Int = 0,
    val serviceState: SignalState = SignalState.UNKNOWN,
    val gpsState: SignalState = SignalState.UNKNOWN,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val db: AppDatabase,
    private val statusStore: HeartbeatStatusStore,
    private val syncStatusStore: SyncStatusStore,
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

    init {
        viewModelScope.launch {
            while (true) {
                refresh()
                delay(15_000)
            }
        }
    }

    private suspend fun refresh() {
        val now = System.currentTimeMillis()
        val lastHeartbeat = statusStore.lastHeartbeatAt()
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
        // SyncWorker runs every 10 minutes (SyncWorker.schedule) — allow one
        // missed cycle plus backoff before calling it unhealthy, same slack
        // HeartbeatWorker's status card gets.
        val syncHealthy = classify(lastSync, now, staleAfterMs = 22 * 60_000L) == SignalState.GOOD
        val gpsState = when {
            lastFix == null -> SignalState.UNKNOWN
            localFixHealthy && syncHealthy -> SignalState.GOOD
            else -> SignalState.STALE
        }
        _uiState.update {
            it.copy(
                isEnrolledDevice = isEnrolledDevice,
                lastHeartbeatAt = lastHeartbeat,
                lastGpsFixAt = lastFix?.ts,
                lastGpsSyncAt = lastSync,
                unsyncedFixCount = unsyncedCount,
                // The heartbeat worker runs every 5 minutes — allow one missed
                // cycle plus retry backoff before calling the service unhealthy.
                serviceState = classify(lastHeartbeat, now, staleAfterMs = 11 * 60_000L),
                gpsState = gpsState,
            )
        }
    }

    private fun classify(ts: Long?, now: Long, staleAfterMs: Long): SignalState = when {
        ts == null -> SignalState.UNKNOWN
        now - ts <= staleAfterMs -> SignalState.GOOD
        else -> SignalState.STALE
    }
}
