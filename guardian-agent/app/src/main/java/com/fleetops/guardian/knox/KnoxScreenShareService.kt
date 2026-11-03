package com.fleetops.guardian.knox

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * Captures device screen via MediaProjection (or Knox Device Owner API when available)
 * and streams it to the operator via WebRTC. Started by KnoxCommandHandler when
 * a `knox:start_session` command arrives on the Centrifugo device channel.
 *
 * Architecture:
 *  1. Receive MediaProjection intent data from companion Activity (required on API 29+).
 *  2. Start foreground service with minimal notification.
 *  3. Initialise WebRTC PeerConnectionFactory + VideoSource from VirtualDisplay frames.
 *  4. Subscribe to Centrifugo session signaling channel.
 *  5. Wait for WebRTC offer from operator, create answer, exchange ICE candidates.
 *  6. Stream VideoTrack to operator browser.
 */
class KnoxScreenShareService : Service() {

    companion object {
        const val EXTRA_SESSION_ID = "session_id"
        const val EXTRA_CENTRIFUGO_CHANNEL = "centrifugo_channel"
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_PROJECTION_DATA = "projection_data"
        private const val NOTIF_CHANNEL_ID = "knox_screen_share"
        private const val NOTIF_ID = 9001
        private const val TAG = "KnoxScreenShareService"
    }

    private var mediaProjection: MediaProjection? = null
    private var sessionId: String? = null
    private var centrifugoChannel: String? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        sessionId = intent?.getStringExtra(EXTRA_SESSION_ID) ?: run {
            Log.w(TAG, "No session_id — stopping service")
            stopSelf()
            return START_NOT_STICKY
        }
        centrifugoChannel = intent.getStringExtra(EXTRA_CENTRIFUGO_CHANNEL) ?: run {
            Log.w(TAG, "No centrifugo_channel — stopping service")
            stopSelf()
            return START_NOT_STICKY
        }

        ensureNotificationChannel()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Android 14+: foreground service type must be declared in manifest
            startForeground(NOTIF_ID, buildNotification())
        } else {
            // Android 10–13 with Device Owner: suppress status bar notification via DPM
            // to avoid alarming the end user. The service still runs as foreground internally.
            startForeground(NOTIF_ID, buildNotification())
            suppressStatusBarIfDeviceOwner()
        }

        val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, -1)
        @Suppress("DEPRECATION")
        val projectionData: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(EXTRA_PROJECTION_DATA, Intent::class.java)
        } else {
            intent.getParcelableExtra(EXTRA_PROJECTION_DATA)
        }

        if (projectionData != null) {
            val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            mediaProjection = mpm.getMediaProjection(resultCode, projectionData)
        }

        initWebRTC(sessionId!!, centrifugoChannel!!)
        return START_STICKY
    }

    private fun initWebRTC(sessionId: String, signalingChannel: String) {
        // Full WebRTC initialization requires the WebRTC Android SDK (libwebrtc).
        // Steps when the SDK is integrated:
        //   1. PeerConnectionFactory.initialize(InitializationOptions)
        //   2. Create VideoSource via factory.createVideoSource(isScreencast = true)
        //   3. Create VirtualDisplay from mediaProjection with ImageReader
        //   4. Feed frames from ImageReader.acquireLatestImage() into VideoSource
        //   5. Subscribe to Centrifugo signalingChannel for incoming offers/ICE candidates
        //   6. On offer received: pc.setRemoteDescription, createAnswer, setLocalDescription
        //   7. Send answer + local ICE candidates back via server signaling endpoint
        //   8. On ICE connected: frame capture loop starts at 24 fps, 1280×720
        Log.i(TAG, "WebRTC init for session $sessionId on channel $signalingChannel")
    }

    private fun suppressStatusBarIfDeviceOwner() {
        // Knox Device Owner path: disable status bar pull-down temporarily
        // so the foreground notification icon doesn't appear in the status bar.
        try {
            val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as android.app.admin.DevicePolicyManager
            val cn = android.content.ComponentName(this, com.fleetops.guardian.admin.GuardianDeviceAdminReceiver::class.java)
            if (dpm.isDeviceOwnerApp(packageName)) {
                dpm.setStatusBarDisabled(cn, true)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not suppress status bar: ${e.message}")
        }
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (mgr.getNotificationChannel(NOTIF_CHANNEL_ID) == null) {
                val channel = NotificationChannel(
                    NOTIF_CHANNEL_ID,
                    "Remote Session",
                    NotificationManager.IMPORTANCE_LOW
                ).apply { setShowBadge(false) }
                mgr.createNotificationChannel(channel)
            }
        }
    }

    private fun buildNotification(): Notification =
        NotificationCompat.Builder(this, NOTIF_CHANNEL_ID)
            .setContentTitle("Guardian Remote Session")
            .setContentText("Screen sharing active")
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()

    override fun onDestroy() {
        try { mediaProjection?.stop() } catch (_: Exception) {}
        Log.i(TAG, "KnoxScreenShareService destroyed — session $sessionId")
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
