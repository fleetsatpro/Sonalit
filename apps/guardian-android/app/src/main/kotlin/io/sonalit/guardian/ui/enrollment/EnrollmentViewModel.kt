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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
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

    fun enroll(deviceId: String, operatorCode: String, integrityToken: String) {
        viewModelScope.launch {
            _state.value = EnrollUiState.Loading
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
                _state.value = when (response.status) {
                    "enrolled" -> EnrollUiState.Enrolled(response.device_uuid)
                    else -> EnrollUiState.PendingApproval(response.device_uuid)
                }
            } catch (e: Exception) {
                _state.value = EnrollUiState.Error(e.message ?: "Enrollment failed")
            }
        }
    }
}
