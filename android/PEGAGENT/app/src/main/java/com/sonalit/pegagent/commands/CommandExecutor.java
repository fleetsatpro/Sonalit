package com.sonalit.pegagent.commands;

import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;

import com.sonalit.pegagent.network.PegApiClient;
import com.sonalit.pegagent.services.PegDeviceAdminReceiver;
import com.sonalit.pegagent.services.RemoteControlAccessibilityService;
import com.sonalit.pegagent.services.ScreenShareService;
import com.sonalit.pegagent.telemetry.LocationEngine;
import com.sonalit.pegagent.util.PegConfig;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import timber.log.Timber;

/**
 * CommandExecutor: routes commands from server to the correct Android API.
 * Designed for nanosecond-to-millisecond execution — no blocking on main thread.
 * Each command type dispatches on a dedicated thread pool.
 */
public class CommandExecutor {

    private final Context ctx;
    private final PegApiClient api;
    private final ExecutorService executor;
    private final Handler mainHandler;

    // Dedicated executors per command category for zero-queue-contention
    private final ExecutorService locationExecutor  = Executors.newSingleThreadExecutor();
    private final ExecutorService mdmExecutor       = Executors.newSingleThreadExecutor();
    private final ExecutorService mediaExecutor     = Executors.newSingleThreadExecutor();

    public CommandExecutor(Context ctx, PegApiClient api) {
        this.ctx = ctx.getApplicationContext();
        this.api = api;
        this.executor = Executors.newCachedThreadPool();
        this.mainHandler = new Handler(Looper.getMainLooper());
    }

    /**
     * Primary entry point. Called immediately when a command arrives from WebSocket or FCM.
     * Dispatches without blocking the caller thread.
     */
    public void execute(PegCommand cmd) {
        if (cmd == null || !cmd.isValid()) {
            Timber.w("Invalid command received, discarding");
            return;
        }

        long startNs = System.nanoTime();
        Timber.i("CMD_RECV id=%s command=%s", cmd.id, cmd.command);

        switch (cmd.command) {
            case PegCommand.CMD_REQUEST_LOCATION:
                locationExecutor.execute(() -> execRequestLocation(cmd, startNs));
                break;
            case PegCommand.CMD_TRIGGER_SIREN:
                mediaExecutor.execute(() -> execTriggerSiren(cmd, startNs));
                break;
            case PegCommand.CMD_LOCK_SCREEN:
                mdmExecutor.execute(() -> execLockScreen(cmd, startNs));
                break;
            case PegCommand.CMD_FORCE_CHECKIN:
                executor.execute(() -> execForceCheckin(cmd, startNs));
                break;
            case PegCommand.CMD_RESTART_APP:
                executor.execute(() -> execRestartApp(cmd, startNs));
                break;
            case PegCommand.CMD_CLEAR_DATA:
                mdmExecutor.execute(() -> execClearData(cmd, startNs));
                break;
            case PegCommand.CMD_REMOTE_WIPE:
                mdmExecutor.execute(() -> execRemoteWipe(cmd, startNs));
                break;
            case PegCommand.CMD_KNOX_START:
                executor.execute(() -> execKnoxStart(cmd, startNs));
                break;
            case PegCommand.CMD_KNOX_END:
                executor.execute(() -> execKnoxEnd(cmd, startNs));
                break;
            case PegCommand.CMD_INJECT_TOUCH:
                RemoteControlAccessibilityService.injectTouch(
                        cmd.payload != null ? cmd.payload.x : 0,
                        cmd.payload != null ? cmd.payload.y : 0,
                        cmd.payload != null ? cmd.payload.action : "tap");
                ackCommand(cmd.id, "executed", startNs);
                break;
            case PegCommand.CMD_INJECT_KEY:
                RemoteControlAccessibilityService.injectKey(
                        cmd.payload != null ? cmd.payload.key : "BACK");
                ackCommand(cmd.id, "executed", startNs);
                break;
            case PegCommand.CMD_PING:
                ackCommand(cmd.id, "pong", startNs);
                break;
            default:
                Timber.w("Unknown command: %s", cmd.command);
                ackCommand(cmd.id, "unknown_command", startNs);
        }
    }

    // ── LOCATION ──────────────────────────────────────────────────────────────

    private void execRequestLocation(PegCommand cmd, long startNs) {
        Timber.d("Executing request_location");
        LocationEngine.getInstance(ctx).getLocationNow(location -> {
            if (location != null) {
                api.sendTelemetryNow(location);
                ackCommand(cmd.id, "executed", startNs);
                Timber.i("Location sent: %.6f, %.6f", location.getLatitude(), location.getLongitude());
            } else {
                ackCommand(cmd.id, "location_unavailable", startNs);
            }
        });
    }

    // ── SIREN ─────────────────────────────────────────────────────────────────

    private void execTriggerSiren(PegCommand cmd, long startNs) {
        Timber.d("Executing trigger_siren");
        try {
            AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);

            // Max volume - bypass any mute settings
            am.setStreamVolume(AudioManager.STREAM_ALARM,
                    am.getStreamMaxVolume(AudioManager.STREAM_ALARM),
                    AudioManager.FLAG_SHOW_UI);

            // Continuous alarm tone - 30 seconds
            ToneGenerator tg = new ToneGenerator(AudioManager.STREAM_ALARM, 100);
            for (int i = 0; i < 10; i++) {
                tg.startTone(ToneGenerator.TONE_CDMA_EMERGENCY_RINGBACK, 2800);
                Thread.sleep(3000);
            }
            tg.release();

            // Vibration pattern: SOS morse
            Vibrator v = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
            long[] pattern = {0, 200, 100, 200, 100, 200, 300, 500, 300, 500, 300, 300, 200, 100, 200, 100, 200};
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                v.vibrate(VibrationEffect.createWaveform(pattern, 0));
            } else {
                v.vibrate(pattern, 0);
            }

            ackCommand(cmd.id, "executed", startNs);
        } catch (Exception e) {
            Timber.e(e, "Siren execution failed");
            ackCommand(cmd.id, "error:" + e.getMessage(), startNs);
        }
    }

    // ── LOCK SCREEN ───────────────────────────────────────────────────────────

    private void execLockScreen(PegCommand cmd, long startNs) {
        Timber.d("Executing lock_screen");
        try {
            DevicePolicyManager dpm =
                    (DevicePolicyManager) ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
            ComponentName admin = new ComponentName(ctx, PegDeviceAdminReceiver.class);

            if (dpm.isAdminActive(admin)) {
                dpm.lockNow(); // Immediate, no dialog
                ackCommand(cmd.id, "executed", startNs);
                Timber.i("Screen locked via DPM");
            } else {
                Timber.w("Device admin not active, lock_screen unavailable");
                ackCommand(cmd.id, "error:not_device_admin", startNs);
            }
        } catch (Exception e) {
            Timber.e(e, "lock_screen failed");
            ackCommand(cmd.id, "error:" + e.getMessage(), startNs);
        }
    }

    // ── FORCE CHECK-IN ────────────────────────────────────────────────────────

    private void execForceCheckin(PegCommand cmd, long startNs) {
        Timber.d("Executing force_checkin");
        // Broadcast to main activity to open check-in flow
        Intent intent = new Intent("com.sonalit.pegagent.ACTION_FORCE_CHECKIN");
        ctx.sendBroadcast(intent);
        ackCommand(cmd.id, "checkin_triggered", startNs);
    }

    // ── RESTART APP ───────────────────────────────────────────────────────────

    private void execRestartApp(PegCommand cmd, long startNs) {
        Timber.d("Executing restart_app");
        ackCommand(cmd.id, "restarting", startNs);
        // Small delay to let ACK go out
        mainHandler.postDelayed(() -> {
            Intent restart = ctx.getPackageManager()
                    .getLaunchIntentForPackage(ctx.getPackageName());
            if (restart != null) {
                restart.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                ctx.startActivity(restart);
            }
            android.os.Process.killProcess(android.os.Process.myPid());
        }, 500);
    }

    // ── CLEAR APP DATA ────────────────────────────────────────────────────────

    private void execClearData(PegCommand cmd, long startNs) {
        Timber.d("Executing clear_app_data");
        try {
            // Clear cached telemetry and session data
            ctx.getCacheDir().delete();
            // Note: shared prefs enrollment data kept intentionally - only clears session/cache
            ackCommand(cmd.id, "executed", startNs);
        } catch (Exception e) {
            ackCommand(cmd.id, "error:" + e.getMessage(), startNs);
        }
    }

    // ── REMOTE WIPE ───────────────────────────────────────────────────────────

    private void execRemoteWipe(PegCommand cmd, long startNs) {
        Timber.d("Executing remote_wipe");
        // Requires confirm flag from server - validated server-side but double-checked here
        if (cmd.payload == null || !cmd.payload.confirm) {
            ackCommand(cmd.id, "error:confirm_required", startNs);
            return;
        }
        try {
            DevicePolicyManager dpm =
                    (DevicePolicyManager) ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
            ComponentName admin = new ComponentName(ctx, PegDeviceAdminReceiver.class);

            if (dpm.isAdminActive(admin)) {
                ackCommand(cmd.id, "wiping", startNs);
                Thread.sleep(500); // let ACK transmit
                dpm.wipeData(DevicePolicyManager.WIPE_RESET_PROTECTION_DATA);
            } else {
                ackCommand(cmd.id, "error:not_device_admin", startNs);
            }
        } catch (Exception e) {
            Timber.e(e, "remote_wipe failed");
            ackCommand(cmd.id, "error:" + e.getMessage(), startNs);
        }
    }

    // ── KNOX SESSION ──────────────────────────────────────────────────────────

    private void execKnoxStart(PegCommand cmd, long startNs) {
        Timber.d("Executing knox:start_session");
        Intent intent = new Intent(ctx, ScreenShareService.class);
        if (cmd.payload != null) {
            intent.putExtra("session_id", cmd.payload.sessionId);
            intent.putExtra("centrifugo_channel", cmd.payload.centrifugoChannel);
        }
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent);
        } else {
            ctx.startService(intent);
        }
        ackCommand(cmd.id, "session_starting", startNs);
    }

    private void execKnoxEnd(PegCommand cmd, long startNs) {
        Timber.d("Executing knox:end_session");
        ctx.stopService(new Intent(ctx, ScreenShareService.class));
        ackCommand(cmd.id, "session_ended", startNs);
    }

    // ── ACK ───────────────────────────────────────────────────────────────────

    private void ackCommand(String commandId, String status, long startNs) {
        long elapsedNs = System.nanoTime() - startNs;
        long elapsedMs = elapsedNs / 1_000_000;
        Timber.i("CMD_ACK id=%s status=%s elapsed=%dms (%dns)", commandId, status, elapsedMs, elapsedNs);
        api.ackCommand(commandId, status, elapsedMs);
    }

    public void shutdown() {
        executor.shutdownNow();
        locationExecutor.shutdownNow();
        mdmExecutor.shutdownNow();
        mediaExecutor.shutdownNow();
    }
}
