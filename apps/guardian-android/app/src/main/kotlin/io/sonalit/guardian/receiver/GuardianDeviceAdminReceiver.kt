package io.sonalit.guardian.receiver

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class GuardianDeviceAdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) {
        Log.i("DeviceAdmin", "Guardian device admin enabled")
    }
    override fun onDisabled(context: Context, intent: Intent) {
        Log.w("DeviceAdmin", "Guardian device admin disabled")
    }
    override fun onPasswordChanged(context: Context, intent: Intent) {
        Log.i("DeviceAdmin", "Device password changed")
    }
}
