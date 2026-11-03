package com.fleetops.guardian;

import android.content.Context;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.os.Vibrator;

public class SirenController {
    private static volatile SirenController instance;

    private Ringtone  activeRingtone = null;
    private Vibrator  activeVibrator = null;
    private boolean   running        = false;

    private SirenController() {}

    public static SirenController getInstance(Context ctx) {
        if (instance == null) {
            synchronized (SirenController.class) {
                if (instance == null) instance = new SirenController();
            }
        }
        return instance;
    }

    public synchronized boolean isRunning() {
        return running;
    }

    public synchronized void start(Context ctx, final int durationMs) {
        stopLocked();  // cancel any running siren first

        activeVibrator = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
        if (activeVibrator != null) {
            long[] pattern = {0, 600, 200, 600, 200, 600, 200, 600};
            activeVibrator.vibrate(pattern, 0);
        }
        try {
            activeRingtone = RingtoneManager.getRingtone(ctx,
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM));
            if (activeRingtone != null) {
                // Force alarm volume to maximum so it cannot be silenced mid-alarm
                AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
                if (am != null) {
                    am.setStreamVolume(
                        AudioManager.STREAM_ALARM,
                        am.getStreamMaxVolume(AudioManager.STREAM_ALARM),
                        0);
                }
                activeRingtone.play();
            }
        } catch (Exception ignored) {}

        running = true;
        // No auto-stop: siren runs until stop() is explicitly called via stop_siren command.
    }

    public synchronized void stop() {
        stopLocked();
    }

    private void stopLocked() {
        running = false;
        if (activeRingtone != null) {
            try { activeRingtone.stop(); } catch (Exception ignored) {}
            activeRingtone = null;
        }
        if (activeVibrator != null) {
            try { activeVibrator.cancel(); } catch (Exception ignored) {}
            activeVibrator = null;
        }
    }
}
