package com.fleetops.guardian.knox

import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.fleetops.guardian.data.prefs.DevicePrefs

/**
 * Extends the Guardian device command handling to process Knox-specific commands.
 * Call [handleKnoxCommand] from within the existing GuardianCommandWorker's when() block
 * when the command type is one of the Knox commands listed below.
 *
 * All commands arrive from the server via Centrifugo — never from direct IPC
 * between APKs. See Cardinal Rule §4 of the build spec.
 */
object KnoxCommandHandler {

    private const val TAG = "KnoxCommandHandler"

    /**
     * Returns true if this command was handled; false if the caller should
     * continue to the next branch in the when() block.
     */
    fun handleKnoxCommand(context: Context, commandType: String, payload: Map<String, Any?>, commandId: String, onAck: (String, String) -> Unit): Boolean {
        return when (commandType) {
            "knox:start_session" -> {
                val sessionId  = payload["session_id"] as? String ?: run {
                    Log.w(TAG, "knox:start_session missing session_id")
                    return false
                }
                val channel = payload["centrifugo_channel"] as? String ?: ""
                val intent = Intent(context, KnoxScreenShareService::class.java).apply {
                    putExtra(KnoxScreenShareService.EXTRA_SESSION_ID, sessionId)
                    putExtra(KnoxScreenShareService.EXTRA_CENTRIFUGO_CHANNEL, channel)
                }
                try {
                    ContextCompat.startForegroundService(context, intent)
                    onAck(commandId, "session_starting")
                    Log.i(TAG, "Knox session starting: $sessionId")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to start KnoxScreenShareService: ${e.message}")
                    onAck(commandId, "error")
                }
                true
            }

            "knox:end_session" -> {
                try {
                    context.stopService(Intent(context, KnoxScreenShareService::class.java))
                    onAck(commandId, "session_ended")
                } catch (e: Exception) {
                    Log.w(TAG, "Error stopping session: ${e.message}")
                }
                true
            }

            "lock_screen" -> {
                try {
                    val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as android.app.admin.DevicePolicyManager
                    dpm.lockNow()
                    onAck(commandId, "executed")
                } catch (e: Exception) {
                    Log.e(TAG, "lock_screen failed: ${e.message}")
                    onAck(commandId, "error")
                }
                true
            }

            "remote_wipe" -> {
                try {
                    val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as android.app.admin.DevicePolicyManager
                    // Device Owner required — no user confirmation dialog is shown
                    onAck(commandId, "executing")
                    dpm.wipeData(0)
                } catch (e: Exception) {
                    Log.e(TAG, "remote_wipe failed: ${e.message}")
                    onAck(commandId, "error")
                }
                true
            }

            "trigger_siren" -> {
                try {
                    val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
                    val savedVolume = audioManager.getStreamVolume(android.media.AudioManager.STREAM_ALARM)
                    audioManager.setStreamVolume(
                        android.media.AudioManager.STREAM_ALARM,
                        audioManager.getStreamMaxVolume(android.media.AudioManager.STREAM_ALARM),
                        0
                    )
                    val ringtone = android.media.RingtoneManager.getRingtone(
                        context,
                        android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_ALARM)
                    )
                    ringtone?.play()
                    onAck(commandId, "executed")
                    // Restore volume after 30 seconds
                    android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                        ringtone?.stop()
                        audioManager.setStreamVolume(android.media.AudioManager.STREAM_ALARM, savedVolume, 0)
                    }, 30_000L)
                } catch (e: Exception) {
                    Log.w(TAG, "trigger_siren fallback failed: ${e.message}")
                    onAck(commandId, "error")
                }
                true
            }

            "inject_touch" -> {
                val x = (payload["x"] as? Number)?.toInt() ?: 0
                val y = (payload["y"] as? Number)?.toInt() ?: 0
                val action = payload["action"] as? String ?: "tap"
                KnoxRemoteControlService.instance?.injectTouch(x, y, action) ?: Log.w(TAG, "KnoxRemoteControlService not connected")
                onAck(commandId, "executed")
                true
            }

            "inject_key" -> {
                val key = payload["key"] as? String ?: return false
                KnoxRemoteControlService.instance?.injectKey(key) ?: Log.w(TAG, "KnoxRemoteControlService not connected")
                onAck(commandId, "executed")
                true
            }

            else -> false
        }
    }
}
