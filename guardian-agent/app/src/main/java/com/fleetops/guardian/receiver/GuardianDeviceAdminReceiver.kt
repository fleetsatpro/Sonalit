package com.fleetops.guardian.receiver

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * DeviceAdminReceiver for enterprise device policy management.
 *
 * This receiver is declared in the manifest with the BIND_DEVICE_ADMIN permission.
 * It enables the app to use DevicePolicyManager features such as:
 *  - lockNow() — remotely lock the screen
 *  - resetPassword() — require a new password (device owner only)
 *  - wipeData() — factory reset (device owner only)
 *
 * The device admin must be activated by the user (or via MDM provisioning)
 * before policy methods are available.
 */
class GuardianDeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        Log.i(TAG, "Device admin enabled")
    }

    override fun onDisabled(context: Context, intent: Intent) {
        Log.w(TAG, "Device admin disabled")
    }

    override fun onPasswordChanged(context: Context, intent: Intent) {
        Log.d(TAG, "Device password changed")
    }

    override fun onPasswordFailed(context: Context, intent: Intent) {
        Log.w(TAG, "Device password attempt failed")
    }

    override fun onPasswordSucceeded(context: Context, intent: Intent) {
        Log.d(TAG, "Device password succeeded")
    }

    override fun onLockTaskModeEntering(context: Context, intent: Intent, pkg: String) {
        Log.i(TAG, "Lock task mode entering: $pkg")
    }

    override fun onLockTaskModeExiting(context: Context, intent: Intent) {
        Log.i(TAG, "Lock task mode exiting")
    }

    companion object {
        private const val TAG = "GuardianDeviceAdmin"
    }
}
