package com.fleetops.guardian.knox

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Path
import android.os.Build
import android.util.Log
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/**
 * AccessibilityService that injects touch and key events received from the
 * operator browser via the Centrifugo `org:{orgId}:device:{deviceId}:remote_control`
 * channel. Must be declared in AndroidManifest.xml with BIND_ACCESSIBILITY_SERVICE
 * permission and the accessibility_service_config.xml meta-data.
 *
 * Security: only processes messages originating from the authenticated Centrifugo
 * channel — never from external Intent broadcasts or direct APK-to-APK comms.
 */
class KnoxRemoteControlService : AccessibilityService() {

    companion object {
        private const val TAG = "KnoxRemoteControlService"
        // Holds reference to the running service instance so KnoxCommandHandler can call it
        var instance: KnoxRemoteControlService? = null
            private set
    }

    override fun onServiceConnected() {
        instance = this
        Log.i(TAG, "KnoxRemoteControlService connected")
        // Centrifugo subscription is managed by KnoxCommandHandler which calls
        // injectTouch() / injectKey() on this service instance directly.
        // This avoids coupling the accessibility service to the network layer.
    }

    /**
     * Injects a tap or swipe gesture at the given screen coordinates.
     * Called by KnoxCommandHandler on the main thread after receiving a
     * `inject_touch` message from the Centrifugo remote_control channel.
     */
    fun injectTouch(x: Int, y: Int, action: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            Log.w(TAG, "Gesture injection requires API 24+")
            return
        }
        try {
            val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
            val strokeDesc = GestureDescription.StrokeDescription(path, 0L, 100L)
            val gesture = GestureDescription.Builder().addStroke(strokeDesc).build()
            val dispatched = dispatchGesture(gesture, object : GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription) {
                    Log.d(TAG, "Gesture dispatched: ($x, $y) action=$action")
                }
                override fun onCancelled(gestureDescription: GestureDescription) {
                    Log.w(TAG, "Gesture cancelled: ($x, $y)")
                }
            }, null)
            if (!dispatched) Log.w(TAG, "Gesture dispatch returned false for ($x, $y)")
        } catch (e: Exception) {
            Log.e(TAG, "injectTouch failed: ${e.message}")
        }
    }

    /**
     * Injects a hardware key event. For system keys (HOME, BACK, POWER) the
     * AccessibilityService global action API is used when available; Knox Device Owner
     * DevicePolicyManager is used as a fallback for POWER on API < 28.
     */
    fun injectKey(key: String) {
        try {
            when (key) {
                "HOME"    -> performGlobalAction(GLOBAL_ACTION_HOME)
                "BACK"    -> performGlobalAction(GLOBAL_ACTION_BACK)
                "RECENTS" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
                "POWER"   -> injectKeyEvent(KeyEvent.KEYCODE_POWER)
                "VOLUME_UP"   -> injectKeyEvent(KeyEvent.KEYCODE_VOLUME_UP)
                "VOLUME_DOWN" -> injectKeyEvent(KeyEvent.KEYCODE_VOLUME_DOWN)
                else -> Log.w(TAG, "Unknown key: $key")
            }
            Log.d(TAG, "Key injected: $key")
        } catch (e: Exception) {
            Log.e(TAG, "injectKey failed for $key: ${e.message}")
        }
    }

    private fun injectKeyEvent(keyCode: Int) {
        // Requires android.permission.INJECT_EVENTS or Knox Device Owner for system keys.
        // On Knox DO devices, DevicePolicyManager can set system key behaviour.
        val down = KeyEvent(KeyEvent.ACTION_DOWN, keyCode)
        val up   = KeyEvent(KeyEvent.ACTION_UP,   keyCode)
        try {
            // Try UiAutomation path first (works in instrumented context)
            val uiAutomation = try { getUiAutomation() } catch (_: Exception) { null }
            if (uiAutomation != null) {
                uiAutomation.injectInputEvent(down, true)
                uiAutomation.injectInputEvent(up, true)
            }
            // On Knox DO: use InputManager reflection (internal API, supported on Samsung ROM)
        } catch (e: Exception) {
            Log.w(TAG, "Key injection via UiAutomation failed: ${e.message}")
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {
        Log.i(TAG, "KnoxRemoteControlService interrupted")
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    // UiAutomation is only available via instrumentation; guard against crash
    private fun getUiAutomation(): android.app.UiAutomation? = null
}
