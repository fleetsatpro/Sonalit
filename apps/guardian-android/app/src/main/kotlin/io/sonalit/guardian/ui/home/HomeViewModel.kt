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
    val serviceState: SignalState = SignalState.UNKNOWN,
    val gpsState: SignalState = SignalState.UNKNOWN,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val db: AppDatabase,
    private val statusStore: HeartbeatStatusStore,
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
        // A CFO-only login auto-provisions a guardian_devices row server-side but
        // never runs device enrollment on this phone, so HeartbeatWorker/
        // GuardianService are never scheduled here — "Service: Not started" is
        // then a correct read of an untracked account, not a failure, and the UI
        // should say so instead of showing it as broken.
        val isEnrolledDevice = prefs.getString("device_id", null) != null && prefs.getString("auth_token", null) != null
        _uiState.update {
            it.copy(
                isEnrolledDevice = isEnrolledDevice,
                lastHeartbeatAt = lastHeartbeat,
                lastGpsFixAt = lastFix?.ts,
                // The heartbeat worker runs every 5 minutes — allow one missed
                // cycle plus retry backoff before calling the service unhealthy.
                serviceState = classify(lastHeartbeat, now, staleAfterMs = 11 * 60_000L),
                // GuardianService buffers a fix every 30s while it's alive.
                gpsState = classify(lastFix?.ts, now, staleAfterMs = 2 * 60_000L),
            )
        }
    }

    private fun classify(ts: Long?, now: Long, staleAfterMs: Long): SignalState = when {
        ts == null -> SignalState.UNKNOWN
        now - ts <= staleAfterMs -> SignalState.GOOD
        else -> SignalState.STALE
    }
}
