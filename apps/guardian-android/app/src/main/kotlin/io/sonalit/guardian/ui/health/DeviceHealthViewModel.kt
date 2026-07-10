package io.sonalit.guardian.ui.health

import android.Manifest
import android.content.Context
import android.content.Intent
import android.hardware.camera2.CameraManager
import android.location.GnssStatus
import android.location.LocationManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.StatFs
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import io.sonalit.guardian.data.local.HeartbeatStatusStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume
import javax.inject.Inject

data class DeviceHealthState(
    val batteryLevel: Int = 0,
    val batteryHealth: String = "Unknown",
    val isCharging: Boolean = false,
    val storageFree: String = "N/A",
    val gpsSatellites: Int = 0,
    val gpsAccuracy: String = "N/A",
    val networkType: String = "N/A",
    val cameraStatus: String = "Unknown",
    val micLevel: String = "N/A",
    val serviceRunning: String = "Unknown",
    val permissions: List<PermissionStatus> = emptyList(),
    val loading: Boolean = false,
)
data class PermissionStatus(val name: String, val granted: Boolean)

@HiltViewModel
class DeviceHealthViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val heartbeatStatusStore: HeartbeatStatusStore,
) : ViewModel() {

    private val _healthState = MutableStateFlow(DeviceHealthState())
    val healthState: StateFlow<DeviceHealthState> = _healthState.asStateFlow()

    fun refresh(context: Context) {
        viewModelScope.launch {
            _healthState.update { it.copy(loading = true) }
            val battery = getBatteryInfo(context)
            val storage = getStorageInfo()
            val gps = getGpsInfo(context)
            val network = getNetworkType(context)
            val camera = checkCamera(context)
            val mic = getMicrophoneLevel(context)
            val service = checkBackgroundService()
            val perms = getPermissionsStatus(context)

            _healthState.value = DeviceHealthState(
                batteryLevel = battery.level,
                batteryHealth = battery.health,
                isCharging = battery.isCharging,
                storageFree = storage,
                gpsSatellites = gps.satellites,
                gpsAccuracy = gps.accuracy,
                networkType = network,
                cameraStatus = camera,
                micLevel = mic,
                serviceRunning = service,
                permissions = perms,
                loading = false,
            )
        }
    }

    private fun getBatteryInfo(context: Context): BatteryData {
        val batteryManager = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val level = batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val status = batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_STATUS)
        val health = when (batteryManager.getIntProperty(BatteryManager.BATTERY_PROPERTY_HEALTH)) {
            BatteryManager.BATTERY_HEALTH_GOOD -> "Good"
            BatteryManager.BATTERY_HEALTH_OVERHEAT -> "Overheat"
            BatteryManager.BATTERY_HEALTH_DEAD -> "Dead"
            BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> "Over Voltage"
            BatteryManager.BATTERY_HEALTH_UNSPECIFIED_FAILURE -> "Failure"
            else -> "Unknown"
        }
        val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
            status == BatteryManager.BATTERY_STATUS_FULL
        return BatteryData(level, health, isCharging)
    }

    private fun getStorageInfo(): String {
        val stat = StatFs(Environment.getDataDirectory().path)
        val bytesAvailable = stat.availableBytes
        val gbAvailable = bytesAvailable / (1024.0 * 1024 * 1024)
        return "%.2f GB".format(gbAvailable)
    }

    /**
     * The original approach (register a GnssStatus.Callback, then read satelliteCount
     * synchronously in the same function) always reported 0 — status updates arrive
     * asynchronously, sometime after registration returns, and the callback was never
     * unregistered either (a leaked GNSS listener). This waits briefly for one real
     * update and always unregisters, on timeout or success.
     */
    private suspend fun getGpsInfo(context: Context): GpsData {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            return GpsData(0, "Permission denied")
        }
        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            ?: return GpsData(0, "N/A")

        val satellites = withTimeoutOrNull(3000L) {
            suspendCancellableCoroutine<Int> { cont ->
                val callback = object : GnssStatus.Callback() {
                    override fun onSatelliteStatusChanged(status: GnssStatus) {
                        if (cont.isActive) cont.resume(status.satelliteCount)
                    }
                }
                locationManager.registerGnssStatusCallback(callback, Handler(Looper.getMainLooper()))
                cont.invokeOnCancellation { locationManager.unregisterGnssStatusCallback(callback) }
            }
        } ?: 0

        val loc = runCatching { locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER) }.getOrNull()
        val accuracy = if (loc != null && loc.hasAccuracy()) "%.1f m".format(loc.accuracy) else "N/A"
        return GpsData(satellites, accuracy)
    }

    private fun getNetworkType(context: Context): String {
        val connectivityManager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val activeNetwork = connectivityManager.activeNetwork
        val caps = connectivityManager.getNetworkCapabilities(activeNetwork)
        return when {
            caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true -> "Cellular"
            caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true -> "WiFi"
            caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true -> "Ethernet"
            else -> "None"
        }
    }

    private fun checkCamera(context: Context): String {
        return try {
            val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val ids = cameraManager.cameraIdList
            if (ids.isEmpty()) "No camera" else "Available (${ids.size})"
        } catch (e: Exception) {
            "Error: ${e.message}"
        }
    }

    private fun getMicrophoneLevel(context: Context): String {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            return "Permission denied"
        }
        var audioRecord: AudioRecord? = null
        try {
            val bufferSize = AudioRecord.getMinBufferSize(44100, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            if (bufferSize <= 0) return "Unavailable"
            audioRecord = AudioRecord(MediaRecorder.AudioSource.MIC, 44100, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufferSize)
            if (audioRecord.state != AudioRecord.STATE_INITIALIZED) return "Unavailable"
            audioRecord.startRecording()
            val buffer = ShortArray(bufferSize)
            val read = audioRecord.read(buffer, 0, bufferSize)
            if (read > 0) {
                var sum = 0.0
                for (i in 0 until read) sum += buffer[i].toDouble() * buffer[i].toDouble()
                val rms = Math.sqrt(sum / read)
                if (rms <= 0.0) return "Silent"
                val db = 20 * Math.log10(rms / 32768.0)
                return "%.1f dB".format(db)
            }
            return "N/A"
        } catch (e: Exception) {
            return "Error"
        } finally {
            runCatching { audioRecord?.stop() }
            audioRecord?.release()
        }
    }

    /** Real signal instead of a hardcoded "Running" placeholder: whether HeartbeatWorker has
     * actually reached the backend recently (same 11-minute staleness window HomeViewModel uses). */
    private fun checkBackgroundService(): String {
        val lastHeartbeat = heartbeatStatusStore.lastHeartbeatAt() ?: return "Never started"
        val staleAfterMs = 11 * 60_000L
        return if (System.currentTimeMillis() - lastHeartbeat <= staleAfterMs) "Running" else "Not responding"
    }

    private fun getPermissionsStatus(context: Context): List<PermissionStatus> {
        val dangerousPerms = listOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.READ_PHONE_STATE,
        )
        return dangerousPerms.map {
            val granted = ContextCompat.checkSelfPermission(context, it) == android.content.pm.PackageManager.PERMISSION_GRANTED
            PermissionStatus(it.substringAfter("permission."), granted)
        }
    }

    fun runFullDiagnostic(context: Context) = refresh(context)

    fun shareReport(context: Context) {
        val state = _healthState.value
        val report = buildString {
            appendLine("Device Health Report")
            appendLine("---------------------")
            appendLine("Battery: ${state.batteryLevel}% (${state.batteryHealth}), Charging: ${state.isCharging}")
            appendLine("Storage Free: ${state.storageFree}")
            appendLine("GPS Satellites: ${state.gpsSatellites}, Accuracy: ${state.gpsAccuracy}")
            appendLine("Network: ${state.networkType}")
            appendLine("Camera: ${state.cameraStatus}")
            appendLine("Microphone Level: ${state.micLevel}")
            appendLine("Background Service: ${state.serviceRunning}")
            appendLine("Permissions:")
            state.permissions.forEach { appendLine("  ${it.name}: ${if (it.granted) "Granted" else "Denied"}") }
        }
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, report)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(Intent.createChooser(intent, "Share Diagnostic Report").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private data class BatteryData(val level: Int, val health: String, val isCharging: Boolean)
    private data class GpsData(val satellites: Int, val accuracy: String)
}
