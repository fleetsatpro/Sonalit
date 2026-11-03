package com.sonalit.pegagent.util;

import android.content.Context;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;

import java.util.concurrent.atomic.AtomicBoolean;

import timber.log.Timber;

/**
 * SirenController — single owner of the emergency siren + vibration.
 *
 * Extracted so both the SOS pipeline (P0-1) and the {@code trigger_siren} /
 * {@code stop_siren} commands (P3-6) drive the exact same code path.
 *
 * The loop is interruptible: {@link #stop()} silences it immediately instead of
 * blocking a worker thread for the full ~30s (the old {@code Thread.sleep(3000)}
 * loop could not be cancelled remotely).
 */
public final class SirenController {

    private static final SirenController INSTANCE = new SirenController();

    private final AtomicBoolean running = new AtomicBoolean(false);
    private Thread sirenThread;
    private ToneGenerator toneGenerator;
    private Vibrator vibrator;

    private SirenController() {}

    public static SirenController get() {
        return INSTANCE;
    }

    public boolean isRunning() {
        return running.get();
    }

    /**
     * Start the siren for up to {@code durationSec} seconds (or until {@link #stop()}).
     * Idempotent: a second call while already running is a no-op.
     */
    public synchronized void start(Context ctx, int durationSec) {
        if (running.getAndSet(true)) {
            Timber.d("Siren already running, ignoring start");
            return;
        }
        final Context app = ctx.getApplicationContext();
        final int cycles = Math.max(1, durationSec / 3);

        sirenThread = new Thread(() -> {
            try {
                AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
                if (am != null) {
                    am.setStreamVolume(AudioManager.STREAM_ALARM,
                            am.getStreamMaxVolume(AudioManager.STREAM_ALARM),
                            AudioManager.FLAG_SHOW_UI);
                }

                toneGenerator = new ToneGenerator(AudioManager.STREAM_ALARM, 100);

                vibrator = (Vibrator) app.getSystemService(Context.VIBRATOR_SERVICE);
                long[] pattern = {0, 200, 100, 200, 100, 200, 300, 500, 300, 500, 300, 300, 200, 100, 200, 100, 200};
                if (vibrator != null && vibrator.hasVibrator()) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                    } else {
                        vibrator.vibrate(pattern, 0);
                    }
                }

                for (int i = 0; i < cycles && running.get(); i++) {
                    toneGenerator.startTone(ToneGenerator.TONE_CDMA_EMERGENCY_RINGBACK, 2800);
                    // Interruptible wait: 3s in 100ms slices so stop() lands fast.
                    for (int j = 0; j < 30 && running.get(); j++) {
                        Thread.sleep(100);
                    }
                }
            } catch (InterruptedException ie) {
                Timber.d("Siren interrupted");
            } catch (Throwable t) {
                Timber.e(t, "Siren loop error");
            } finally {
                cleanup();
                running.set(false);
                Timber.i("Siren stopped");
            }
        }, "pegagent-siren");
        sirenThread.start();
        Timber.i("Siren started for %ds", durationSec);
    }

    /** Silence the siren immediately. Safe to call when not running. */
    public synchronized void stop() {
        if (!running.getAndSet(false)) return;
        Thread t = sirenThread;
        if (t != null) t.interrupt();
        cleanup();
    }

    private void cleanup() {
        try {
            if (toneGenerator != null) {
                toneGenerator.stopTone();
                toneGenerator.release();
                toneGenerator = null;
            }
        } catch (Throwable ignored) {}
        try {
            if (vibrator != null) {
                vibrator.cancel();
                vibrator = null;
            }
        } catch (Throwable ignored) {}
    }
}
