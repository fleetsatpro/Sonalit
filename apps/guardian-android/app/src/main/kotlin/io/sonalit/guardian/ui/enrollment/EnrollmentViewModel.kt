package io.sonalit.guardian.ui.enrollment

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
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
    private val api: GuardianApi,
) : ViewModel() {

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
