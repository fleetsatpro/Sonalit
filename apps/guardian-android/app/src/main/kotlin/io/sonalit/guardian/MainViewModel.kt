package io.sonalit.guardian

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import io.sonalit.guardian.service.GuardianService
import io.sonalit.guardian.worker.HeartbeatWorker
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class MainUiState(
    val isEnrolled: Boolean = false,
    val pendingDeepLink: String? = null,
)

@HiltViewModel
class MainViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
) : ViewModel() {

    private val _uiState = MutableStateFlow(MainUiState())
    val uiState: StateFlow<MainUiState> = _uiState.asStateFlow()

    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "guardian_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    init {
        checkEnrollmentStatus()
    }

    private fun checkEnrollmentStatus() {
        val deviceId = prefs.getString("device_id", null)
        val authToken = prefs.getString("auth_token", null)
        val isEnrolled = deviceId != null && authToken != null
        _uiState.update { it.copy(isEnrolled = isEnrolled) }
        if (isEnrolled) ensureBackgroundServicesRunning()
    }

    fun markEnrolled() {
        _uiState.update { it.copy(isEnrolled = true) }
        ensureBackgroundServicesRunning()
    }

    /**
     * GuardianService and HeartbeatWorker were previously only ever started from
     * BootReceiver (device reboot) or an already-running device's own remote
     * "restart_app" command — so a freshly enrolled device (or one that kept its
     * credentials across an app reinstall) never actually ran either until the
     * next reboot: no heartbeat, no GPS, and no volume-key SOS trigger, since that
     * receiver is only registered at runtime inside GuardianService.onCreate().
     * Calling this everywhere enrollment state can become true — cold start,
     * fresh enrollment, and remote-approved enrollment — closes that gap.
     * startForegroundService and enqueueUniquePeriodicWork(..., KEEP, ...) are both
     * safe to call repeatedly; an already-running instance is left alone.
     */
    private fun ensureBackgroundServicesRunning() {
        val deviceId = prefs.getString("device_id", null) ?: return
        ContextCompat.startForegroundService(context, Intent(context, GuardianService::class.java))
        HeartbeatWorker.schedule(context, deviceId = deviceId)
    }

    fun handleDeepLink(uri: String) {
        val destination = when {
            uri.contains("/guardian/enroll") -> "enroll"
            uri.contains("/guardian/cfo") -> "cfo"
            uri.contains("/guardian/home") -> "home"
            else -> null
        }
        _uiState.update { it.copy(pendingDeepLink = destination) }
    }

    fun clearDeepLink() {
        _uiState.update { it.copy(pendingDeepLink = null) }
    }

    fun handleFcmNotification(data: Map<String, String>) {
        viewModelScope.launch {
            when (data["type"]) {
                // Command pushes are data-only (no `notification` block), so they're
                // already picked up and executed by
                // GuardianFirebaseMessagingService.onMessageReceived directly — that
                // fires whether or not this activity is open. This branch would only
                // ever see a "command" payload via a notification tap, which commands
                // don't produce, so there's nothing to do here.
                // panic_ack has no local UI state to update anymore — PanicViewModel
                // (ui/panic) now owns the whole panic lifecycle via direct HTTP responses
                // from /guardian/panic and /guardian/panic/cancel, not FCM pushes.
                "enrollment_approved" -> {
                    _uiState.update { it.copy(isEnrolled = true) }
                    ensureBackgroundServicesRunning()
                }
            }
        }
    }
}
