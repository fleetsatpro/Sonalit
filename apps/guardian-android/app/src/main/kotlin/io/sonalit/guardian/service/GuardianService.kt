package io.sonalit.guardian.service

import android.app.*
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.location.Location
import android.media.AudioManager
import android.os.*
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

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private lateinit var fusedClient: FusedLocationProviderClient
    private lateinit var activityClient: ActivityRecognitionClient
    // VOLUME_CHANGED_ACTION is an implicit broadcast Android 8+ mostly refuses to deliver to a
    // manifest-declared <receiver> — registering it at runtime here (while this foreground
    // service is alive) is the path that actually works; the manifest entry is defense-in-depth
    // only for OEMs that still deliver it that way.
    private val volumeKeyReceiver = VolumeKeySOSReceiver()

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
            this, volumeKeyReceiver, IntentFilter(AudioManager.VOLUME_CHANGED_ACTION),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
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
        scope.cancel()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
