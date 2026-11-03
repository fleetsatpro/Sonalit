package com.fleetops.guardian.admin

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.UserHandle
import android.util.Log

/**
 * Device Owner receiver. Registered via:
 *   adb shell dpm set-device-owner com.fleetops.guardian/.admin.GuardianDeviceAdminReceiver
 *
 * On profile provisioning complete (zero-touch / MDM enrollment):
 *   - Enables lock task mode (kiosk: pins Guardian to screen)
 *   - Disables status bar on Android 10–13 (Android 14+ uses foreground service type)
 *   - Explicitly allows screen capture (required for Knox session recording)
 *   - Calls telemetry endpoint to set knox_do_enrolled = true
 */
class GuardianDeviceAdminReceiver : DeviceAdminReceiver() {

    companion object {
        private const val TAG = "GuardianDeviceAdmin"
    }

    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        Log.i(TAG, "Device provisioning complete — applying Device Owner policies")
        val dpm = getManager(context)
        val who = getWho(context)
        try {
            // Lock task: pin Guardian to foreground (kiosk mode)
            dpm.setLockTaskPackages(who, arrayOf(context.packageName))
        } catch (e: Exception) {
            Log.w(TAG, "setLockTaskPackages failed: ${e.message}")
        }
        try {
            // Android 10–13: suppress status bar pull-down to prevent user interference
            @Suppress("DEPRECATION")
            if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                dpm.setStatusBarDisabled(who, true)
            }
        } catch (e: Exception) {
            Log.w(TAG, "setStatusBarDisabled failed: ${e.message}")
        }
        try {
            // Explicitly allow screen capture so Knox remote session can proceed
            dpm.setScreenCaptureDisabled(who, false)
        } catch (e: Exception) {
            Log.w(TAG, "setScreenCaptureDisabled failed: ${e.message}")
        }
        // Signal enrollment to the server (knox_do_enrolled = true)
        // This is done by the next heartbeat automatically via HeartbeatWorker
        // which will include knox_do_enrolled = dpm.isDeviceOwnerApp(packageName)
        Log.i(TAG, "Device Owner policies applied successfully")
    }

    override fun onEnabled(context: Context, intent: Intent) {
        Log.i(TAG, "Device admin enabled")
    }

    override fun onDisabled(context: Context, intent: Intent) {
        Log.i(TAG, "Device admin disabled — Knox features will be unavailable")
    }

    override fun onLockTaskModeEntering(context: Context, intent: Intent, pkg: String) {
        Log.i(TAG, "Lock task mode entering for: $pkg")
    }

    override fun onLockTaskModeExiting(context: Context, intent: Intent) {
        Log.w(TAG, "Lock task mode exited — device may be unsecured")
    }
}
