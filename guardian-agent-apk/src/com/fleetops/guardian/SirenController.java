package com.fleetops.guardian;

import android.content.Context;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.os.Handler;
import android.os.Looper;
import android.os.Vibrator;

public class SirenController {
    private static volatile SirenController instance;

    private final Handler  handler = new Handler(Looper.getMainLooper());
    private Ringtone  activeRingtone = null;
    private Vibrator  activeVibrator = null;
    private Runnable  stopTask       = null;

    private SirenController() {}

    public static SirenController getInstance(Context ctx) {
        if (instance == null) {
            synchronized (SirenController.class) {
                if (instance == null) instance = new SirenController();
            }
        }
        return instance;
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
            if (activeRingtone != null) activeRingtone.play();
        } catch (Exception ignored) {}

        stopTask = new Runnable() {
            @Override public void run() {
                synchronized (SirenController.this) { stopLocked(); }
            }
        };
        handler.postDelayed(stopTask, durationMs);
    }

    public synchronized void stop() {
        stopLocked();
    }

    private void stopLocked() {
        if (stopTask != null) { handler.removeCallbacks(stopTask); stopTask = null; }
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
