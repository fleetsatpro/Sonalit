package com.fleetops.guardian.service

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Binder
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.fleetops.guardian.GuardianApplication
import com.fleetops.guardian.R
import com.fleetops.guardian.data.api.CommandDto
import com.fleetops.guardian.data.prefs.DevicePrefs
import com.fleetops.guardian.data.repository.GuardianRepository
import com.fleetops.guardian.data.repository.PanicMode
import com.fleetops.guardian.receiver.GuardianDeviceAdminReceiver
import com.fleetops.guardian.ui.main.MainActivity
import com.fleetops.guardian.util.batteryCharging
import com.fleetops.guardian.util.batteryLevel
import com.fleetops.guardian.util.networkType
import com.fleetops.guardian.util.signalStrength
import com.google.android.gms.location.*
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

@AndroidEntryPoint
class GuardianService : LifecycleService() {

    @Inject lateinit var repository: GuardianRepository
    @Inject lateinit var devicePrefs: DevicePrefs

    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private var locationCallback: LocationCallback? = null
    private var locationJob: Job? = null

    private val _trackingMode = MutableStateFlow(DevicePrefs.TrackingMode.NORMAL)
    private var cachedTrackingInterval = DevicePrefs.DEFAULT_INTERVAL_SECONDS
    val trackingMode: StateFlow<String> = _trackingMode.asStateFlow()

    private val _isOnline = MutableStateFlow(false)
    val isOnline: StateFlow<Boolean> = _isOnline.asStateFlow()

    private val _batteryLevel = MutableStateFlow(-1)
    val batteryLevel: StateFlow<Int> = _batteryLevel.asStateFlow()

    private val _batteryCharging = MutableStateFlow(false)
    val batteryCharging: StateFlow<Boolean> = _batteryCharging.asStateFlow()

    private val _signalStrength = MutableStateFlow(0)
    val signalStrength: StateFlow<Int> = _signalStrength.asStateFlow()

    private val _networkType = MutableStateFlow("offline")
    val networkType: StateFlow<String> = _networkType.asStateFlow()

    private val _lastCommandId = MutableStateFlow<String?>(null)
    val lastCommandId: StateFlow<String?> = _lastCommandId.asStateFlow()

    private var sirenPlayer: MediaPlayer? = null
    private var sirenJob: kotlinx.coroutines.Job? = null
    private val _batteryAlertSent = MutableStateFlow(false)

    private var lastKnownLat: Double? = null
    private var lastKnownLng: Double? = null

    // Binder for activity binding
    inner class GuardianBinder : Binder() {
        fun getService(): GuardianService = this@GuardianService
    }
    private val binder = GuardianBinder()

    override fun onBind(intent: Intent): IBinder {
        super.onBind(intent)
        return binder
    }

    override fun onCreate() {
        super.onCreate()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        setupCommandProcessor()
        startForegroundWithNotification()
        observePreferences()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        when (intent?.action) {
            ACTION_STOP -> {
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
            ACTION_QUICK_PANIC -> {
                lifecycleScope.launch {
                    repository.triggerPanic(PanicMode.SILENT, "Quick panic via shortcut", lastKnownLat, lastKnownLng)
                }
            }
            else -> startLocationUpdates()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopLocationUpdates()
        stopSiren()
        super.onDestroy()
    }

    // ─── Foreground Notification ──────────────────────────────────────────────

    private fun startForegroundWithNotification() {
        val notification = buildNotification(DevicePrefs.TrackingMode.NORMAL, true)
        startForeground(GuardianApplication.NOTIFICATION_ID_SERVICE, notification)
    }

    private fun buildNotification(mode: String, online: Boolean): Notification {
        val statusEmoji = if (online) "🟢" else "🔴"
        val modeLabel = mode.replaceFirstChar { it.uppercase() }
        val contentText = "Guardian Active | $statusEmoji ${if (online) "Online" else "Offline"} | Mode: $modeLabel"

        val mainIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingMain = PendingIntent.getActivity(
            this, 0, mainIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val stopIntent = Intent(this, GuardianService::class.java).apply {
            action = ACTION_STOP
        }
        val pendingStop = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, GuardianApplication.CHANNEL_GUARDIAN_SERVICE)
            .setContentTitle("FleetOps Guardian")
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setShowWhen(false)
            .setContentIntent(pendingMain)
            .addAction(android.R.drawable.ic_delete, "Stop", pendingStop)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun updateNotification(mode: String, online: Boolean) {
        val notification = buildNotification(mode, online)
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(GuardianApplication.NOTIFICATION_ID_SERVICE, notification)
    }

    // ─── Preferences Observer ─────────────────────────────────────────────────

    private fun observePreferences() {
        lifecycleScope.launch {
            devicePrefs.trackingModeFlow.collect { mode ->
                if (_trackingMode.value != mode) {
                    _trackingMode.value = mode
                    restartLocationUpdates()
                    updateNotification(mode, _isOnline.value)
                }
            }
        }
        lifecycleScope.launch {
            devicePrefs.trackingIntervalSecondsFlow.collect { interval ->
                if (cachedTrackingInterval != interval) {
                    cachedTrackingInterval = interval
                    restartLocationUpdates()
                }
            }
        }
    }

    // ─── Location Updates ─────────────────────────────────────────────────────

    @SuppressLint("MissingPermission")
    private fun startLocationUpdates() {
        stopLocationUpdates()

        val intervalMs = computeIntervalMs(_trackingMode.value, cachedTrackingInterval.toLong())

        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
            .setMinUpdateIntervalMillis(intervalMs / 2)
            .setMaxUpdateDelayMillis(intervalMs * 2)
            .setWaitForAccurateLocation(false)
            .build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val location = result.lastLocation ?: return
                locationJob?.cancel()
                locationJob = lifecycleScope.launch {
                    _isOnline.value = true
                    lastKnownLat = location.latitude
                    lastKnownLng = location.longitude
                    _batteryLevel.value = applicationContext.batteryLevel()
                    _batteryCharging.value = applicationContext.batteryCharging()
                    _signalStrength.value = applicationContext.signalStrength()
                    _networkType.value = applicationContext.networkType()
                    val bat = _batteryLevel.value
                    if (bat in 1..9 && !_batteryAlertSent.value) {
                        _batteryAlertSent.value = true
                        lifecycleScope.launch {
                            repository.triggerPanic(
                                mode = PanicMode.SILENT,
                                message = "AUTO: Battery critical at ${bat}%",
                                lat = location.latitude,
                                lng = location.longitude
                            )
                        }
                    } else if (bat >= 15) {
                        _batteryAlertSent.value = false
                    }
                    repository.sendLocation(
                        lat = location.latitude,
                        lng = location.longitude,
                        altitude = if (location.hasAltitude()) location.altitude else null,
                        speed = if (location.hasSpeed()) location.speed else null,
                        heading = if (location.hasBearing()) location.bearing else null,
                        accuracy = if (location.hasAccuracy()) location.accuracy else null
                    )
                }
            }

            override fun onLocationAvailability(availability: LocationAvailability) {
                _isOnline.value = availability.isLocationAvailable
                updateNotification(_trackingMode.value, availability.isLocationAvailable)
            }
        }

        try {
            fusedLocationClient.requestLocationUpdates(
                request,
                locationCallback!!,
                Looper.getMainLooper()
            )
        } catch (e: SecurityException) {
            Log.e(TAG, "Location permission denied", e)
        }
    }

    private fun stopLocationUpdates() {
        locationCallback?.let {
            fusedLocationClient.removeLocationUpdates(it)
            locationCallback = null
        }
        locationJob?.cancel()
    }

    private fun restartLocationUpdates() {
        stopLocationUpdates()
        startLocationUpdates()
    }

    private fun computeIntervalMs(mode: String, defaultSeconds: Long): Long {
        val seconds = when (mode) {
            DevicePrefs.TrackingMode.LIVE -> 5L
            DevicePrefs.TrackingMode.EMERGENCY -> 3L
            DevicePrefs.TrackingMode.STEALTH -> maxOf(defaultSeconds, 60L)
            else -> defaultSeconds
        }
        return seconds * 1000L
    }

    // ─── Command Processing ───────────────────────────────────────────────────

    private fun setupCommandProcessor() {
        // Drain the repository channel on the service's lifecycle scope (Main dispatcher).
        // Commands buffered while the service was stopped are processed immediately on start.
        lifecycleScope.launch {
            for (command in repository.commandChannel) {
                try {
                    processCommand(command)
                } catch (e: Exception) {
                    Log.e(TAG, "Unhandled error processing command ${command.commandId}", e)
                    repository.ackCommand(command.commandId, "failed")
                }
            }
        }
    }

    private suspend fun processCommand(command: CommandDto) {
        Log.i(TAG, "Processing command: ${command.type} (${command.commandId})")
        _lastCommandId.value = command.commandId

        try {
            when (command.type) {
                "lock_screen" -> executeLockScreen(command)
                "push_message" -> executePushMessage(command)
                "update_config" -> executeUpdateConfig(command)
                "set_tracking_mode" -> {
                    val mode = command.payload?.get("mode") ?: return
                    devicePrefs.setTrackingMode(mode)
                }
                "reboot" -> {
                    Log.w(TAG, "Reboot command received but requires device-owner policy")
                    repository.ackCommand(command.commandId, "failed")
                    return
                }
                "wipe" -> {
                    Log.w(TAG, "Wipe command received but requires device-owner policy")
                    repository.ackCommand(command.commandId, "failed")
                    return
                }
                "trigger_siren" -> {
                    val duration = command.payload?.get("duration")?.toIntOrNull() ?: 30
                    // MediaPlayer requires a Looper thread — switch to Main
                    withContext(Dispatchers.Main) { triggerSiren(duration) }
                }
                "stop_siren" -> withContext(Dispatchers.Main) { stopSiren() }
                "start_live_tracking" -> devicePrefs.setTrackingMode(DevicePrefs.TrackingMode.LIVE)
                "stop_live_tracking" -> devicePrefs.setTrackingMode(DevicePrefs.TrackingMode.NORMAL)
                "force_sync" -> {
                    lifecycleScope.launch { repository.syncPendingUploads() }
                }
                else -> {
                    Log.w(TAG, "Unknown command type: ${command.type}")
                    repository.ackCommand(command.commandId, "failed")
                    return
                }
            }
            repository.ackCommand(command.commandId, "executed")
        } catch (e: Exception) {
            Log.e(TAG, "Error executing command ${command.commandId}", e)
            repository.ackCommand(command.commandId, "failed")
        }
    }

    private fun executeLockScreen(command: CommandDto) {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val adminComponent = ComponentName(this, GuardianDeviceAdminReceiver::class.java)
        if (dpm.isAdminActive(adminComponent)) {
            dpm.lockNow()
            Log.i(TAG, "Screen locked by command")
        } else {
            Log.w(TAG, "Cannot lock screen — not device admin")
        }
    }

    private fun executePushMessage(command: CommandDto) {
        val title = command.payload?.get("title") ?: "Fleet Message"
        val body = command.payload?.get("body") ?: command.payload?.get("message") ?: ""
        val priority = command.payload?.get("priority") ?: "normal"

        val channelId = if (priority == "high") {
            GuardianApplication.CHANNEL_ALERTS
        } else {
            GuardianApplication.CHANNEL_COMMANDS
        }

        val mainIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, command.commandId.hashCode(), mainIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .setPriority(
                if (priority == "high") NotificationCompat.PRIORITY_HIGH
                else NotificationCompat.PRIORITY_DEFAULT
            )
            .build()

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(GuardianApplication.NOTIFICATION_ID_COMMAND + command.commandId.hashCode(), notification)
    }

    private suspend fun executeUpdateConfig(command: CommandDto) {
        command.payload?.get("tracking_mode")?.let { mode ->
            devicePrefs.setTrackingMode(mode)
        }
        command.payload?.get("tracking_interval_seconds")?.toIntOrNull()?.let { interval ->
            devicePrefs.setTrackingIntervalSeconds(interval)
        }
    }

    private fun triggerSiren(durationSeconds: Int = 30) {
        try {
            val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            audioManager.setStreamVolume(
                AudioManager.STREAM_ALARM,
                audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM),
                0
            )
            val alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                ?: run {
                    Log.e(TAG, "No alarm or ringtone URI available")
                    return
                }

            sirenPlayer?.apply { if (isPlaying) stop(); release() }
            sirenPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setDataSource(applicationContext, alarmUri)
                isLooping = true
                prepare()
                start()
            }

            sirenJob?.cancel()
            sirenJob = lifecycleScope.launch {
                delay(durationSeconds.toLong() * 1000)
                stopSiren()
            }
            Log.i(TAG, "Siren triggered for ${durationSeconds}s")
        } catch (e: Exception) {
            Log.e(TAG, "Siren failed: ${e.message}")
        }
    }

    private fun stopSiren() {
        sirenJob?.cancel()
        sirenJob = null
        sirenPlayer?.apply { if (isPlaying) stop(); release() }
        sirenPlayer = null
        Log.i(TAG, "Siren stopped")
    }

    companion object {
        private const val TAG = "GuardianService"
        const val ACTION_STOP = "com.fleetops.guardian.action.STOP_SERVICE"
        const val ACTION_QUICK_PANIC = "com.fleetops.guardian.action.QUICK_PANIC"

        fun startService(context: Context) {
            val intent = Intent(context, GuardianService::class.java)
            context.startForegroundService(intent)
        }

        fun stopService(context: Context) {
            val intent = Intent(context, GuardianService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }
}
