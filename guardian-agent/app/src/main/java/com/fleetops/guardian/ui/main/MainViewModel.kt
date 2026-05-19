package com.fleetops.guardian.ui.main

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fleetops.guardian.data.prefs.DevicePrefs
import com.fleetops.guardian.data.repository.GuardianRepository
import com.fleetops.guardian.data.repository.PanicMode
import com.fleetops.guardian.data.repository.RepositoryResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed class PanicUiState {
    object Idle : PanicUiState()
    object Loading : PanicUiState()
    data class Success(val incidentId: String?) : PanicUiState()
    data class Error(val message: String) : PanicUiState()
    object Queued : PanicUiState()
}

sealed class ReportUiState {
    object Idle : ReportUiState()
    object Loading : ReportUiState()
    data class Success(val reportId: String) : ReportUiState()
    data class Error(val message: String) : ReportUiState()
    object Queued : ReportUiState()
}

data class DeviceStatusUi(
    val isOnline: Boolean = false,
    val trackingMode: String = "normal",
    val batteryLevel: Int = -1,
    val batteryCharging: Boolean = false,
    val signalStrength: Int = 0,
    val networkType: String = "offline",
    val deviceId: String = "",
    val deviceName: String = ""
)

@HiltViewModel
class MainViewModel @Inject constructor(
    private val repository: GuardianRepository,
    private val devicePrefs: DevicePrefs
) : ViewModel() {

    private val _panicState = MutableStateFlow<PanicUiState>(PanicUiState.Idle)
    val panicState: StateFlow<PanicUiState> = _panicState.asStateFlow()

    private val _reportState = MutableStateFlow<ReportUiState>(ReportUiState.Idle)
    val reportState: StateFlow<ReportUiState> = _reportState.asStateFlow()

    private val _deviceStatus = MutableStateFlow(DeviceStatusUi())
    val deviceStatus: StateFlow<DeviceStatusUi> = _deviceStatus.asStateFlow()

    // Injected from bound service — updated by MainActivity
    private val _serviceOnline = MutableStateFlow(false)
    val serviceOnline: StateFlow<Boolean> = _serviceOnline.asStateFlow()

    private val _serviceTrackingMode = MutableStateFlow(DevicePrefs.TrackingMode.NORMAL)
    val serviceTrackingMode: StateFlow<String> = _serviceTrackingMode.asStateFlow()

    // Last known location from service
    var lastKnownLat: Double? = null
    var lastKnownLng: Double? = null

    init {
        observePreferences()
    }

    private fun observePreferences() {
        viewModelScope.launch {
            devicePrefs.deviceIdFlow.collect { id ->
                _deviceStatus.value = _deviceStatus.value.copy(deviceId = id)
            }
        }
        viewModelScope.launch {
            devicePrefs.deviceNameFlow.collect { name ->
                _deviceStatus.value = _deviceStatus.value.copy(deviceName = name)
            }
        }
        viewModelScope.launch {
            devicePrefs.trackingModeFlow.collect { mode ->
                _deviceStatus.value = _deviceStatus.value.copy(trackingMode = mode)
                _serviceTrackingMode.value = mode
            }
        }
    }

    fun updateServiceState(online: Boolean, trackingMode: String) {
        _serviceOnline.value = online
        _serviceTrackingMode.value = trackingMode
        _deviceStatus.value = _deviceStatus.value.copy(
            isOnline = online,
            trackingMode = trackingMode
        )
    }

    fun updateHardwareState(batteryLevel: Int, batteryCharging: Boolean, signalStrength: Int, networkType: String) {
        _deviceStatus.value = _deviceStatus.value.copy(
            batteryLevel = batteryLevel,
            batteryCharging = batteryCharging,
            signalStrength = signalStrength,
            networkType = networkType
        )
    }

    // ─── Panic ────────────────────────────────────────────────────────────────

    fun triggerPanic(mode: PanicMode, message: String?) {
        if (_panicState.value is PanicUiState.Loading) return

        viewModelScope.launch {
            _panicState.value = PanicUiState.Loading

            when (val result = repository.triggerPanic(
                mode = mode,
                message = message,
                lat = lastKnownLat,
                lng = lastKnownLng
            )) {
                is RepositoryResult.Success -> {
                    _panicState.value = PanicUiState.Success(result.data.incidentId)
                }
                is RepositoryResult.Error -> {
                    // Distinguish "queued" from actual error
                    if (result.message.contains("queued", ignoreCase = true)) {
                        _panicState.value = PanicUiState.Queued
                    } else {
                        _panicState.value = PanicUiState.Error(result.message)
                    }
                }
            }
        }
    }

    fun resetPanicState() {
        _panicState.value = PanicUiState.Idle
    }

    // ─── Report ───────────────────────────────────────────────────────────────

    fun submitReport(category: String, description: String) {
        if (_reportState.value is ReportUiState.Loading) return

        if (description.trim().isEmpty()) {
            _reportState.value = ReportUiState.Error("Description is required")
            return
        }

        viewModelScope.launch {
            _reportState.value = ReportUiState.Loading

            when (val result = repository.submitReport(
                category = category,
                description = description,
                lat = lastKnownLat,
                lng = lastKnownLng
            )) {
                is RepositoryResult.Success -> {
                    _reportState.value = ReportUiState.Success(result.data.reportId)
                }
                is RepositoryResult.Error -> {
                    if (result.message.contains("queued", ignoreCase = true) ||
                        result.message.contains("offline", ignoreCase = true)) {
                        _reportState.value = ReportUiState.Queued
                    } else {
                        _reportState.value = ReportUiState.Error(result.message)
                    }
                }
            }
        }
    }

    fun resetReportState() {
        _reportState.value = ReportUiState.Idle
    }
}
