package io.sonalit.guardian.ui.enrollment

import android.content.Context
import android.content.SharedPreferences
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import io.sonalit.guardian.data.remote.GuardianApi
import io.sonalit.guardian.data.remote.EnrollRequest
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject
import retrofit2.HttpException
import javax.inject.Inject

sealed interface EnrollUiState {
    data object Idle : EnrollUiState
    data object Loading : EnrollUiState
    data class PendingApproval(val deviceUuid: String) : EnrollUiState
    data class Enrolled(val deviceUuid: String) : EnrollUiState
    data class Error(val message: String) : EnrollUiState
}

@HiltViewModel
class EnrollmentViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: GuardianApi,
) : ViewModel() {

    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context, "guardian_prefs", masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    private val _state = MutableStateFlow<EnrollUiState>(EnrollUiState.Idle)
    val state: StateFlow<EnrollUiState> = _state

    private var pollJob: Job? = null

    /**
     * The dispatcher approving an enrollment on the ops dashboard used to be
     * invisible to the officer's phone — the screen said "Awaiting operator
     * approval" and just sat there forever with no way to find out it had
     * actually been approved short of force-quitting and reopening the app.
     * Re-enrolling with the same device_id/operator_code is safe (the
     * backend's dedup path just reports current status), so poll it in the
     * background and flip to Enrolled the moment approval lands.
     */
    fun enroll(deviceId: String, operatorCode: String, integrityToken: String) {
        pollJob?.cancel()
        viewModelScope.launch {
            _state.value = EnrollUiState.Loading
            attemptEnroll(deviceId, operatorCode, integrityToken)
        }
    }

    private suspend fun attemptEnroll(deviceId: String, operatorCode: String, integrityToken: String) {
        try {
            val response = api.enroll(EnrollRequest(
                device_id = deviceId,
                operator_code = operatorCode,
                play_integrity_token = integrityToken,
                platform = "android",
            ))
            // Persist credentials so subsequent requests can authenticate
            prefs.edit()
                .putString("device_id", response.device_uuid)
                .putString("auth_token", response.device_token)
                .apply()
            when (response.status) {
                "enrolled" -> _state.value = EnrollUiState.Enrolled(response.device_uuid)
                else -> {
                    _state.value = EnrollUiState.PendingApproval(response.device_uuid)
                    startPolling(deviceId, operatorCode, integrityToken)
                }
            }
        } catch (e: Exception) {
            _state.value = EnrollUiState.Error(friendlyMessage(e))
        }
    }

    private fun startPolling(deviceId: String, operatorCode: String, integrityToken: String) {
        pollJob = viewModelScope.launch {
            while (true) {
                delay(8_000)
                if (_state.value !is EnrollUiState.PendingApproval) return@launch
                // Silent re-check — do NOT surface transient network errors here,
                // the officer is already looking at "awaiting approval"; only a
                // definitive status change (enrolled, or a hard rejection) should
                // update what they see.
                runCatching {
                    api.enroll(EnrollRequest(
                        device_id = deviceId,
                        operator_code = operatorCode,
                        play_integrity_token = integrityToken,
                        platform = "android",
                    ))
                }.onSuccess { response ->
                    if (response.status == "enrolled") {
                        prefs.edit()
                            .putString("device_id", response.device_uuid)
                            .putString("auth_token", response.device_token)
                            .apply()
                        _state.value = EnrollUiState.Enrolled(response.device_uuid)
                    }
                }
            }
        }
    }

    /** Lets the officer back out of a stuck pending-approval screen to re-enter their badge number. */
    fun startOver() {
        pollJob?.cancel()
        _state.value = EnrollUiState.Idle
    }

    override fun onCleared() {
        super.onCleared()
        pollJob?.cancel()
    }

    private fun friendlyMessage(e: Exception): String {
        if (e is HttpException) {
            val body = runCatching { e.response()?.errorBody()?.string() }.getOrNull()
            val serverMessage = body?.let { runCatching { JSONObject(it).optString("error").ifBlank { null } }.getOrNull() }
            if (serverMessage != null) return serverMessage
            return when (e.code()) {
                429 -> "Too many attempts — wait a minute and try again."
                in 500..599 -> "Server is having trouble right now. Try again shortly."
                else -> "Enrollment failed (${e.code()}). Check your badge number and try again."
            }
        }
        return "Couldn't reach the server. Check your connection and try again."
    }
}
