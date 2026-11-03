package com.fleetops.guardian.ui.enrollment

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fleetops.guardian.data.prefs.DevicePrefs
import com.fleetops.guardian.data.repository.GuardianRepository
import com.fleetops.guardian.data.repository.RepositoryResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed class EnrollmentUiState {
    object Idle : EnrollmentUiState()
    object Loading : EnrollmentUiState()
    object Success : EnrollmentUiState()
    data class Error(val message: String) : EnrollmentUiState()
}

@HiltViewModel
class EnrollmentViewModel @Inject constructor(
    private val repository: GuardianRepository,
    private val devicePrefs: DevicePrefs
) : ViewModel() {

    private val _uiState = MutableStateFlow<EnrollmentUiState>(EnrollmentUiState.Idle)
    val uiState: StateFlow<EnrollmentUiState> = _uiState.asStateFlow()

    private val _alreadyEnrolled = MutableStateFlow(false)
    val alreadyEnrolled: StateFlow<Boolean> = _alreadyEnrolled.asStateFlow()

    init {
        checkEnrollmentStatus()
    }

    private fun checkEnrollmentStatus() {
        viewModelScope.launch {
            _alreadyEnrolled.value = devicePrefs.isEnrolled()
        }
    }

    fun enroll(serverUrl: String, orgToken: String, deviceName: String) {
        if (_uiState.value is EnrollmentUiState.Loading) return

        // Input validation
        val trimmedUrl = serverUrl.trim()
        val trimmedToken = orgToken.trim()
        val trimmedName = deviceName.trim()

        when {
            trimmedUrl.isEmpty() -> {
                _uiState.value = EnrollmentUiState.Error("Server URL is required")
                return
            }
            !trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://") -> {
                _uiState.value = EnrollmentUiState.Error("Server URL must start with http:// or https://")
                return
            }
            trimmedToken.isEmpty() -> {
                _uiState.value = EnrollmentUiState.Error("Organisation token is required")
                return
            }
            trimmedName.isEmpty() -> {
                _uiState.value = EnrollmentUiState.Error("Device name is required")
                return
            }
            trimmedName.length < 3 -> {
                _uiState.value = EnrollmentUiState.Error("Device name must be at least 3 characters")
                return
            }
        }

        viewModelScope.launch {
            _uiState.value = EnrollmentUiState.Loading

            when (val result = repository.enroll(trimmedUrl, trimmedToken, trimmedName)) {
                is RepositoryResult.Success -> {
                    _alreadyEnrolled.value = true
                    _uiState.value = EnrollmentUiState.Success
                }
                is RepositoryResult.Error -> {
                    _uiState.value = EnrollmentUiState.Error(
                        message = result.message.ifBlank { "Enrollment failed — check server URL and token" }
                    )
                }
            }
        }
    }

    fun resetError() {
        if (_uiState.value is EnrollmentUiState.Error) {
            _uiState.value = EnrollmentUiState.Idle
        }
    }

    fun skipToMain() {
        // Allow skipping enrollment if already enrolled (e.g., app restart)
        if (_alreadyEnrolled.value) {
            _uiState.value = EnrollmentUiState.Success
        }
    }
}
