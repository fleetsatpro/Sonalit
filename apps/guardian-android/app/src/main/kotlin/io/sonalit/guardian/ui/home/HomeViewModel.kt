package io.sonalit.guardian.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
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
    val lastHeartbeatAt: Long? = null,
    val lastGpsFixAt: Long? = null,
    val serviceState: SignalState = SignalState.UNKNOWN,
    val gpsState: SignalState = SignalState.UNKNOWN,
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val db: AppDatabase,
    private val statusStore: HeartbeatStatusStore,
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

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
        _uiState.update {
            it.copy(
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
