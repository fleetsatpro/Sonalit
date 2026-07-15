package io.sonalit.guardian.service

import android.Manifest
import android.app.*
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.*
import android.support.v4.media.session.MediaSessionCompat
import android.util.Log
import android.view.KeyEvent
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.*
import com.google.android.gms.tasks.CancellationTokenSource
import dagger.hilt.android.AndroidEntryPoint
import io.sonalit.guardian.R
import io.sonalit.guardian.data.local.AppDatabase
import io.sonalit.guardian.data.local.GpsFixEntity
import io.sonalit.guardian.data.local.HeartbeatStatusStore
import io.sonalit.guardian.receiver.VolumeKeySOSReceiver
import kotlinx.coroutines.*
import java.util.UUID
import javax.inject.Inject

@AndroidEntryPoint
class GuardianService : Service() {

    @Inject lateinit var db: AppDatabase
    @Inject lateinit var panicSender: PanicSender
    @Inject lateinit var statusStore: HeartbeatStatusStore

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private lateinit var fusedClient: FusedLocationProviderClient
    private lateinit var activityClient: ActivityRecognitionClient
    private lateinit var mediaSession: MediaSessionCompat

    private val volumeKeyReceiver = VolumeKeySOSReceiver()

    // True once requestLocationUpdates has been successfully handed to the
    // fused client. Reset on registration failure so the ticker retries.
    @Volatile private var locationUpdatesActive = false

    // Headset button triple-press state
    private var btnPressCount = 0
    private var lastBtnPressMs = 0L

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            result.lastLocation?.let { bufferFix(it) }
        }
    }

    override fun onCreate() {
        super.onCreate()
        fusedClient = LocationServices.getFusedLocationProviderClient(this)
        activityClient = ActivityRecognition.getClient(this)
        startForeground()
        // Record liveness immediately so the Home "Service" card flips to
        // "Running" the instant the service starts, rather than waiting on the
        // ~15-min network heartbeat worker (which could never keep it fresh).
        statusStore.recordServiceAlive()
        checkPlayServicesAvailability()
        tryStartLocationUpdates()
        startLivenessTicker()
        ContextCompat.registerReceiver(
            this, volumeKeyReceiver, IntentFilter(VolumeKeySOSReceiver.VOLUME_CHANGED_ACTION),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        registerMediaSession()
    }

    /** FusedLocationProviderClient depends entirely on Play Services — on a
     *  device where it's missing, disabled, or too outdated, every location
     *  call above fails (or silently never resolves) with nothing in the UI
     *  to explain why. Logged once at startup so that case is diagnosable. */
    private fun checkPlayServicesAvailability() {
        val status = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(this)
        if (status != ConnectionResult.SUCCESS) {
            Log.e(TAG, "Google Play Services unavailable (status=$status) — location fixes will never arrive")
        }
    }

    /** Beats a local proof-of-life every 60s so the Home screen can tell the
     *  service is genuinely alive without depending on the network heartbeat.
     *  Doubles as the retry loop for location registration: on a first launch
     *  this service is started BEFORE the runtime permission dialog is even
     *  shown, so the one-shot registration in onCreate() fails and — being
     *  START_STICKY — the service would otherwise live forever without a
     *  location listener ("GPS: No fix yet" with Service: Running). */
    private fun startLivenessTicker() {
        scope.launch {
            while (isActive) {
                statusStore.recordServiceAlive()
                tryStartLocationUpdates()
                delay(60_000L)
            }
        }
    }

    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    /** Registers location updates once permission is actually held. Safe to
     *  call repeatedly (onCreate, every onStartCommand, the liveness ticker) —
     *  it no-ops while registered and retries after grant or a failed
     *  registration, instead of the old register-once-at-birth behaviour. */
    private fun tryStartLocationUpdates() {
        if (locationUpdatesActive) return
        if (!hasLocationPermission()) {
            Log.w(TAG, "Location permission not granted yet — GPS registration deferred, will retry")
            return
        }
        locationUpdatesActive = true
        requestLocationUpdates(intervalMs = 30_000L)
        // Grab one fix right now instead of waiting up to 30s for the first
        // interval callback — this is what clears "GPS: No fix yet" seconds
        // after the officer arms the device.
        requestImmediateFix()
    }

    @Suppress("MissingPermission")
    private fun requestImmediateFix() {
        runCatching {
            fusedClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, CancellationTokenSource().token)
                .addOnSuccessListener { loc ->
                    if (loc == null) {
                        Log.w(TAG, "requestImmediateFix: succeeded but returned null location (no provider had a recent fix cached)")
                    } else {
                        bufferFix(loc)
                    }
                }
                .addOnFailureListener { e ->
                    // Silently swallowing this (as the old code did) is exactly why
                    // "GPS: No fix yet" was undiagnosable on a real device with location
                    // services on — this is the one place that would have shown a
                    // ResolvableApiException (location settings not satisfied) or a
                    // missing/outdated Play Services error.
                    Log.e(TAG, "requestImmediateFix failed", e)
                }
        }.onFailure { e -> Log.e(TAG, "requestImmediateFix threw synchronously", e) }
    }

    /**
     * Registers a MediaSession so headset/earpiece inline buttons are delivered
     * to this service. Three presses within 2 s fires the same panic path as
     * VolumeKeySOSReceiver — useful when the phone is pocketed and the officer
     * is wearing an earpiece.
     *
     * MediaSession does NOT require the screen to be on, and the button callback
     * fires inside this foreground service so there are no background launch
     * restrictions to deal with — the panic call goes out directly.
     */
    private fun registerMediaSession() {
        mediaSession = MediaSessionCompat(this, "GuardianSOS").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onMediaButtonEvent(mediaButtonIntent: Intent?): Boolean {
                    val ke: KeyEvent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        mediaButtonIntent?.getParcelableExtra(Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        mediaButtonIntent?.getParcelableExtra(Intent.EXTRA_KEY_EVENT)
                    }
                    if (ke == null || ke.action != KeyEvent.ACTION_DOWN) return false

                    val now = System.currentTimeMillis()
                    btnPressCount = if (now - lastBtnPressMs < 2000L) btnPressCount + 1 else 1
                    lastBtnPressMs = now

                    if (btnPressCount >= 3) {
                        btnPressCount = 0
                        Log.w(TAG, "Headset button triple press — triggering panic")
                        scope.launch { panicSender.send(mode = "silent") }
                    }
                    return true
                }
            })
            isActive = true
        }
    }

    private fun startForeground() {
        val channelId = "guardian_service"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(channelId, "Guardian Service", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        val notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("Guardian Active")
            .setContentText("Monitoring location")
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(1, notification)
        }
    }

    @Suppress("MissingPermission")
    private fun requestLocationUpdates(intervalMs: Long) {
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
            .setMinUpdateIntervalMillis(intervalMs / 2)
            .build()
        // The returned Task was previously discarded — a registration failure
        // (e.g. location settings not satisfied, provider unavailable) would
        // then look identical to "working fine, just no fix yet" forever.
        fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
            .addOnFailureListener { e ->
                // Let the liveness ticker retry rather than staying dead forever.
                locationUpdatesActive = false
                Log.e(TAG, "requestLocationUpdates registration failed", e)
            }
    }

    private fun bufferFix(location: Location) {
        scope.launch {
            db.gpsFixDao().insert(GpsFixEntity(
                id = UUID.randomUUID().toString(),
                lat = location.latitude,
                lon = location.longitude,
                speed = location.speed,
                heading = location.bearing,
                accuracy = location.accuracy,
                ts = location.time,
                synced = false,
            ))
            // Every delivered fix is also proof the service is alive.
            statusStore.recordServiceAlive()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // MainActivity pokes the service (startForegroundService on an already-
        // running instance) right after the location permission is granted —
        // this is what picks the grant up immediately instead of waiting for
        // the next ticker beat.
        tryStartLocationUpdates()
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        fusedClient.removeLocationUpdates(locationCallback)
        runCatching { unregisterReceiver(volumeKeyReceiver) }
        mediaSession.isActive = false
        mediaSession.release()
        scope.cancel()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val TAG = "GuardianService"
    }
}
