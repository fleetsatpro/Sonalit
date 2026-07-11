package io.sonalit.guardian.service

import android.app.*
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.*
import android.support.v4.media.session.MediaSessionCompat
import android.util.Log
import android.view.KeyEvent
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.*
import dagger.hilt.android.AndroidEntryPoint
import io.sonalit.guardian.R
import io.sonalit.guardian.data.local.AppDatabase
import io.sonalit.guardian.data.local.GpsFixEntity
import io.sonalit.guardian.receiver.VolumeKeySOSReceiver
import kotlinx.coroutines.*
import java.util.UUID
import javax.inject.Inject

@AndroidEntryPoint
class GuardianService : Service() {

    @Inject lateinit var db: AppDatabase
    @Inject lateinit var panicSender: PanicSender

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private lateinit var fusedClient: FusedLocationProviderClient
    private lateinit var activityClient: ActivityRecognitionClient
    private lateinit var mediaSession: MediaSessionCompat

    private val volumeKeyReceiver = VolumeKeySOSReceiver()

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
        requestLocationUpdates(intervalMs = 30_000L)
        ContextCompat.registerReceiver(
            this, volumeKeyReceiver, IntentFilter(VolumeKeySOSReceiver.VOLUME_CHANGED_ACTION),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        registerMediaSession()
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
        fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
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
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

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
