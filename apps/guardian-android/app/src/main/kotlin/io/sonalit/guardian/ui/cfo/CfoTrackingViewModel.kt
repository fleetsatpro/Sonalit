package io.sonalit.guardian.ui.cfo

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import io.sonalit.guardian.data.remote.GuardianApi
import io.sonalit.guardian.data.remote.TrackingQrData
import io.sonalit.guardian.data.remote.TrackingQrRequest
import io.sonalit.guardian.data.remote.TrackingStatusData
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * CFO tracking-activation state.
 *
 * Guardian's half of Hybrid Tracking: mint a QR for a truck, show it, and watch
 * the convoy board until every vehicle is reporting. This ViewModel owns no
 * tracking business logic — the backend decides token issuance, lifecycle,
 * termination policy and health, and this simply renders what it is told.
 *
 * The raw QR token is held in memory for as long as the code is on screen and
 * is never written to disk or logged. It is a one-time activation credential;
 * losing it costs a regeneration, whereas persisting it would create a second
 * place a scannable journey credential could leak from.
 */

data class CfoTrackingUiState(
    val loading: Boolean = false,
    val error: String? = null,
    val board: TrackingStatusData? = null,
    /** The QR currently being displayed, if any. Cleared when the CFO backs out. */
    val activeQr: TrackingQrData? = null,
    val generatingFor: String? = null,
    val lastRefreshedAt: Long? = null,
)

@HiltViewModel
class CfoTrackingViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val api: GuardianApi,
) : ViewModel() {

    private val _state = MutableStateFlow(CfoTrackingUiState())
    val state: StateFlow<CfoTrackingUiState> = _state.asStateFlow()

    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            appContext, "guardian_prefs", masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    private val deviceToken get() = prefs.getString("auth_token", null) ?: ""

    init {
        refresh()
        // Poll the board while this screen is alive. A CFO standing at the
        // roadside needs to see a driver's scan land without touching anything;
        // 15s is frequent enough to feel live without burning a field device's
        // battery. The poll stops with the ViewModel's scope.
        viewModelScope.launch {
            while (isActive) {
                delay(15_000)
                loadBoard(silent = true)
            }
        }
    }

    fun refresh() = loadBoard(silent = false)

    private fun loadBoard(silent: Boolean) {
        viewModelScope.launch {
            if (!silent) _state.update { it.copy(loading = true, error = null) }
            try {
                val resp = api.cfoTrackingStatus(deviceToken)
                _state.update {
                    it.copy(loading = false, board = resp.data, error = null,
                        lastRefreshedAt = System.currentTimeMillis())
                }
            } catch (e: Exception) {
                Log.w(TAG, "tracking board refresh failed: ${e.message}")
                // A failed silent poll must not wipe a board the CFO is reading,
                // nor replace a displayed QR with an error.
                if (!silent) {
                    _state.update { it.copy(loading = false, error = "Could not load tracking status.") }
                }
            }
        }
    }

    /**
     * Mint (or replace) the QR for one truck. The backend supersedes any earlier
     * open code for that vehicle, so a convoy can never have two scannable links
     * in circulation for the same truck.
     */
    fun generateQr(convoyTruckId: String) {
        viewModelScope.launch {
            _state.update { it.copy(generatingFor = convoyTruckId, error = null) }
            try {
                val resp = api.cfoTrackingQr(deviceToken, TrackingQrRequest(convoyTruckId))
                _state.update { it.copy(generatingFor = null, activeQr = resp.data) }
                loadBoard(silent = true)
            } catch (e: Exception) {
                Log.w(TAG, "QR generation failed: ${e.message}")
                _state.update {
                    it.copy(generatingFor = null, error = "Could not generate the tracking QR. Try again.")
                }
            }
        }
    }

    /** Drop the displayed code from memory once the CFO leaves the QR view. */
    fun dismissQr() = _state.update { it.copy(activeQr = null) }

    fun clearError() = _state.update { it.copy(error = null) }

    private companion object { const val TAG = "CfoTracking" }
}
