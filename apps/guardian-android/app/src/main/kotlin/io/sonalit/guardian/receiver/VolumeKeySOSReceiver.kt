package io.sonalit.guardian.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.util.Log
import io.sonalit.guardian.ui.panic.PanicActivity

/**
 * Triple volume-key press within 2s triggers panic without needing the app
 * open. Caveat worth knowing: AudioManager.VOLUME_CHANGED_ACTION only fires
 * when the stream's volume value actually changes — pressing volume-up
 * repeatedly at max (or volume-down at 0) stops producing new broadcasts, and
 * any other app/media adjusting volume in the same 2s window also counts
 * toward the press count. This is a real hardware-trigger gap inherent to
 * using this broadcast rather than a true key-event hook (which requires an
 * always-on foreground service intercepting key events, a much bigger change)
 * — treat it as a convenience trigger, not the primary one.
 */
class VolumeKeySOSReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "VolumeKeySOS"
        private var pressCount = 0
        private var lastPressTime = 0L
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != AudioManager.VOLUME_CHANGED_ACTION) return

        val now = System.currentTimeMillis()
        pressCount = if (now - lastPressTime < 2000) pressCount + 1 else 1
        lastPressTime = now

        if (pressCount >= 3) {
            Log.w(TAG, "Volume key triple press detected — triggering panic")
            pressCount = 0
            val panicIntent = Intent(context, PanicActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            context.startActivity(panicIntent)
        }
    }
}
