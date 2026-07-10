package io.sonalit.guardian

import android.content.Context
import android.content.SharedPreferences
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
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
        _uiState.update { it.copy(isEnrolled = deviceId != null && authToken != null) }
    }

    fun markEnrolled() {
        _uiState.update { it.copy(isEnrolled = true) }
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
                }
            }
        }
    }
}
