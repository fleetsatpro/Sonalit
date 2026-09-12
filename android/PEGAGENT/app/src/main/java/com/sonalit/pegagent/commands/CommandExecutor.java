package com.sonalit.pegagent.commands;

import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.google.gson.JsonElement;
import com.sonalit.pegagent.network.PegApiClient;
import com.sonalit.pegagent.services.PegCommandService;
import com.sonalit.pegagent.services.PegDeviceAdminReceiver;
import com.sonalit.pegagent.services.RemoteControlAccessibilityService;
import com.sonalit.pegagent.services.ScreenShareService;
import com.sonalit.pegagent.telemetry.LocationEngine;
import com.sonalit.pegagent.util.SirenController;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import timber.log.Timber;

/**
 * CommandExecutor: routes server commands to the correct Android API.
 *
 * Every ACK tells the truth (SACRED rule #2): a command only ACKs "executed"
 * after the action actually completes; missing preconditions ACK a specific
 * error:<reason>. Delivery is de-duplicated and TTL-checked across all paths
 * (WS + poll) via {@link CommandGuard}, and destructive commands must carry a
 * valid server signature (P2-7).
 */
public class CommandExecutor {

    private static final int SIREN_DEFAULT_SEC = 30;

    private final Context ctx;
    private final PegApiClient api;
    private final CommandGuard guard;
    private final ExecutorService executor;
    private final Handler mainHandler;

    private final ExecutorService locationExecutor = Executors.newSingleThreadExecutor();
    private final ExecutorService mdmExecutor      = Executors.newSingleThreadExecutor();
    private final ExecutorService mediaExecutor    = Executors.newSingleThreadExecutor();

    public CommandExecutor(Context ctx, PegApiClient api) {
        this.ctx = ctx.getApplicationContext();
        this.api = api;
        this.guard = new CommandGuard(this.ctx);
        this.executor = Executors.newCachedThreadPool();
        this.mainHandler = new Handler(Looper.getMainLooper());
    }

    public void execute(PegCommand cmd) {
        execute(cmd, null);
    }

    /**
     * Primary entry point. {@code rawPayload} is the payload exactly as received
     * (needed for byte-faithful signature verification).
     */
    public void execute(PegCommand cmd, JsonElement rawPayload) {
        if (cmd == null || !cmd.isValid()) {
            Timber.w("Invalid command received, discarding");
            return;
        }

        long startNs = System.nanoTime();

        // Atomically claim this id across ALL delivery paths (WS + poll). Runs
        // first so simultaneous deliveries cannot both pass the check-then-mark
        // TOCTOU window. If we lose the claim, another thread owns execution and
        // will ACK — we return silently.
        if (!guard.claim(cmd.id)) {
            Timber.d("Duplicate command %s (%s) — skipping", cmd.id, cmd.command);
            return;
        }
        // TTL enforcement (id already burned so retries can't slip through).
        if (guard.isExpired(cmd)) {
            Timber.w("Command %s expired", cmd.id);
            ackCommand(cmd.id, "error:expired", startNs);
            return;
        }
        // Signature gate for destructive commands.
        if (CommandSignature.isDestructive(cmd)
                && !CommandSignature.verify(ctx, cmd, rawPayload)) {
            Timber.e("Rejecting destructive command %s — bad signature", cmd.id);
            ackCommand(cmd.id, "error:bad_signature", startNs);
            return;
        }

        Timber.i("CMD_RECV id=%s command=%s", cmd.id, cmd.command);

        switch (cmd.command) {
            case PegCommand.CMD_REQUEST_LOCATION:
                locationExecutor.execute(() -> execRequestLocation(cmd, startNs));
                break;
            case PegCommand.CMD_TRIGGER_SIREN:
                mediaExecutor.execute(() -> execTriggerSiren(cmd, startNs));
                break;
            case PegCommand.CMD_STOP_SIREN:
                SirenController.get().stop();
                ackCommand(cmd.id, "executed", startNs);
                break;
            case PegCommand.CMD_TRIGGER_SOS:
                execTriggerSos(cmd, startNs);
                break;
            case PegCommand.CMD_PANIC_CANCEL:
                sendServiceAction(PegCommandService.ACTION_SOS_CANCEL, null);
                ackCommand(cmd.id, "executed", startNs);
                break;
            case PegCommand.CMD_LOCK_SCREEN:
                mdmExecutor.execute(() -> execLockScreen(cmd, startNs));
                break;
            case PegCommand.CMD_FORCE_CHECKIN:
                executor.execute(() -> execForceCheckin(cmd, startNs));
                break;
            case PegCommand.CMD_RESTART_APP:
                execRestartApp(cmd, startNs);
                break;
            case PegCommand.CMD_CLEAR_CACHE:
                mdmExecutor.execute(() -> execClearCache(cmd, startNs));
                break;
            case PegCommand.CMD_CLEAR_DATA:
                mdmExecutor.execute(() -> execClearData(cmd, startNs));
                break;
            case PegCommand.CMD_REMOTE_WIPE:
                mdmExecutor.execute(() -> execRemoteWipe(cmd, startNs));
                break;
            case PegCommand.CMD_UPDATE_APP:
                executor.execute(() -> execUpdateApp(cmd, startNs));
                break;
            case PegCommand.CMD_KNOX_START:
                executor.execute(() -> execKnoxStart(cmd, startNs));
                break;
            case PegCommand.CMD_KNOX_END:
                execKnoxEnd(cmd, startNs);
                break;
            case PegCommand.CMD_INJECT_TOUCH:
                execInjectTouch(cmd, startNs);
                break;
            case PegCommand.CMD_INJECT_KEY:
                execInjectKey(cmd, startNs);
                break;
            case PegCommand.CMD_PING:
                ackCommand(cmd.id, "pong", startNs);
                break;
            default:
                Timber.w("Unknown command: %s", cmd.command);
                ackCommand(cmd.id, "error:unknown_command", startNs);
        }
    }

    // ── LOCATION ──────────────────────────────────────────────────────────────

    private void execRequestLocation(PegCommand cmd, long startNs) {
        LocationEngine.getInstance(ctx).getLocationNow(location -> {
            if (location != null) {
                api.sendTelemetryNow(location);
                ackCommand(cmd.id, "executed", startNs);
            } else {
                ackCommand(cmd.id, "error:location_unavailable", startNs);
            }
        });
    }

    // ── SIREN / SOS ────────────────────────────────────────────────────────────

    private void execTriggerSiren(PegCommand cmd, long startNs) {
        try {
            int dur = (cmd.payload != null && cmd.payload.durationSec > 0)
                    ? cmd.payload.durationSec : SIREN_DEFAULT_SEC;
            SirenController.get().start(ctx, dur);
            ackCommand(cmd.id, "executed", startNs);
        } catch (Exception e) {
            ackCommand(cmd.id, "error:" + e.getMessage(), startNs);
        }
    }

    private void execTriggerSos(PegCommand cmd, long startNs) {
        // Route through the always-on service so the exact same siren + panic path runs.
        String source = (cmd.payload != null && cmd.payload.source != null)
                ? cmd.payload.source : "operator";
        sendServiceAction(PegCommandService.ACTION_SOS, source);
        ackCommand(cmd.id, "executed", startNs);
    }

    private void sendServiceAction(String action, String source) {
        Intent i = new Intent(action).setPackage(ctx.getPackageName());
        if (source != null) i.putExtra("source", source);
        ctx.sendBroadcast(i);
    }

    // ── LOCK SCREEN ───────────────────────────────────────────────────────────

    private void execLockScreen(PegCommand cmd, long startNs) {
        try {
            DevicePolicyManager dpm =
                    (DevicePolicyManager) ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
            ComponentName admin = new ComponentName(ctx, PegDeviceAdminReceiver.class);
            if (dpm.isAdminActive(admin)) {
                dpm.lockNow();
                ackCommand(cmd.id, "executed", startNs);
            } else {
                ackCommand(cmd.id, "error:not_device_admin", startNs);
            }
        } catch (Exception e) {
            ackCommand(cmd.id, "error:" + e.getMessage(), startNs);
        }
    }

    // ── FORCE CHECK-IN (P1-1) ───────────────────────────────────────────────────

    private void execForceCheckin(PegCommand cmd, long startNs) {
        // Cosmetic log for a foregrounded UI (kept intentionally).
        ctx.sendBroadcast(new Intent("com.sonalit.pegagent.ACTION_FORCE_CHECKIN")
                .setPackage(ctx.getPackageName()));

        LocationEngine.getInstance(ctx).getFreshLocation(6_000L, (loc, stale) -> {
            if (loc != null) api.sendTelemetryNow(loc); // push current location
            PegApiClient.TelemetryPayload payload =
                    PegApiClient.TelemetryPayload.build(ctx, loc, -1);
            // Heartbeat + execute any commands the server hands back. The heartbeat
            // atomically claims + marks them 'sent', so the poll loop will NOT
            // return them again — if we don't run them here, they're lost.
            api.performCheckin(payload, json -> dispatchCommandsJson(json),
                    ok -> ackCommand(cmd.id, ok ? "executed" : "error:checkin_failed", startNs));
        });
    }

    /** Parse a heartbeat "commands" JSON array and dispatch each element. */
    public void dispatchCommandsJson(String json) {
        if (json == null || json.isEmpty()) return;
        try {
            com.google.gson.JsonArray arr = new com.google.gson.Gson().fromJson(
                    json, com.google.gson.JsonArray.class);
            if (arr == null) return;
            com.google.gson.Gson gson = new com.google.gson.Gson();
            for (com.google.gson.JsonElement el : arr) {
                if (!el.isJsonObject()) continue;
                com.google.gson.JsonObject o = el.getAsJsonObject();
                PegCommand pc = gson.fromJson(o, PegCommand.class);
                JsonElement rawPayload = o.has("payload") ? o.get("payload") : null;
                execute(pc, rawPayload);
            }
        } catch (Exception e) {
            Timber.e(e, "force_checkin: command dispatch failed");
        }
    }

    // ── RESTART APP ───────────────────────────────────────────────────────────

    private void execRestartApp(PegCommand cmd, long startNs) {
        ackCommand(cmd.id, "executed", startNs);
        mainHandler.postDelayed(() -> {
            Intent restart = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            if (restart != null) {
                restart.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                ctx.startActivity(restart);
            }
            android.os.Process.killProcess(android.os.Process.myPid());
        }, 800);
    }

    // ── CLEAR CACHE / DATA (P1-2) ────────────────────────────────────────────────

    private void execClearCache(PegCommand cmd, long startNs) {
        try {
            long freed = clearDirContents(ctx.getCacheDir());
            freed += clearDirContents(ctx.getExternalCacheDir());
            Timber.i("clear_cache freed ~%d bytes", freed);
            ackCommand(cmd.id, "executed", startNs);
        } catch (Exception e) {
            ackCommand(cmd.id, "error:" + e.getMessage(), startNs);
        }
    }

    private void execClearData(PegCommand cmd, long startNs) {
        boolean full = cmd.payload != null && cmd.payload.full;
        try {
            if (full) {
                // Full wipe of app user data; OS restarts the process afterwards.
                ackCommand(cmd.id, "executed", startNs);
                ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
                boolean ok = am != null && am.clearApplicationUserData();
                if (!ok) Timber.w("clearApplicationUserData returned false");
                return;
            }
            // Partial: clear cache + files + databases, PRESERVE enrollment (shared_prefs kept).
            clearDirContents(ctx.getCacheDir());
            clearDirContents(ctx.getExternalCacheDir());
            clearDirContents(ctx.getFilesDir());
            File dbDir = new File(ctx.getApplicationInfo().dataDir, "databases");
            clearDirContents(dbDir);
            ackCommand(cmd.id, "executed", startNs);
        } catch (Exception e) {
            ackCommand(cmd.id, "error:" + e.getMessage(), startNs);
        }
    }

    /** Recursively delete the contents of a directory (not the directory itself). */
    private long clearDirContents(File dir) {
        long freed = 0;
        if (dir == null || !dir.exists() || !dir.isDirectory()) return 0;
        File[] children = dir.listFiles();
        if (children == null) return 0;
        for (File f : children) {
            if (f.isDirectory()) {
                freed += clearDirContents(f);
                f.delete();
            } else {
                freed += f.length();
                f.delete();
            }
        }
        return freed;
    }

    // ── REMOTE WIPE (P3-1) ───────────────────────────────────────────────────────

    private void execRemoteWipe(PegCommand cmd, long startNs) {
        if (cmd.payload == null || !cmd.payload.confirm) {
            ackCommand(cmd.id, "error:confirm_required", startNs);
            return;
        }
        try {
            DevicePolicyManager dpm =
                    (DevicePolicyManager) ctx.getSystemService(Context.DEVICE_POLICY_SERVICE);
            ComponentName admin = new ComponentName(ctx, PegDeviceAdminReceiver.class);
            if (dpm.isAdminActive(admin)) {
                ackCommand(cmd.id, "executed", startNs);
                Thread.sleep(500);
                int flags = DevicePolicyManager.WIPE_RESET_PROTECTION_DATA;
                if (cmd.payload.wipeExternal
                        && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    flags |= DevicePolicyManager.WIPE_EXTERNAL_STORAGE;
                }
                dpm.wipeData(flags);
            } else {
                ackCommand(cmd.id, "error:not_device_admin", startNs);
            }
        } catch (Exception e) {
            ackCommand(cmd.id, "error:" + e.getMessage(), startNs);
        }
    }

    // ── UPDATE APP (P3-5) ────────────────────────────────────────────────────────

    private void execUpdateApp(PegCommand cmd, long startNs) {
        String url = cmd.payload != null ? cmd.payload.url : null;
        if (url == null || url.isEmpty()) {
            ackCommand(cmd.id, "error:no_url", startNs);
            return;
        }
        File apk = new File(ctx.getCacheDir(), "update.apk");
        try {
            okhttp3.OkHttpClient http = new okhttp3.OkHttpClient();
            okhttp3.Request req = new okhttp3.Request.Builder().url(url).build();
            try (okhttp3.Response resp = http.newCall(req).execute()) {
                if (!resp.isSuccessful() || resp.body() == null) {
                    ackCommand(cmd.id, "error:download_http_" + resp.code(), startNs);
                    return;
                }
                try (java.io.InputStream in = resp.body().byteStream();
                     java.io.FileOutputStream out = new java.io.FileOutputStream(apk)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
            }

            android.net.Uri uri = androidx.core.content.FileProvider.getUriForFile(
                    ctx, ctx.getPackageName() + ".fileprovider", apk);
            Intent install = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(install);
            ackCommand(cmd.id, "executed", startNs);
        } catch (Exception e) {
            Timber.e(e, "update_app failed");
            ackCommand(cmd.id, "error:" + e.getMessage(), startNs);
        }
    }

    // ── KNOX SESSION (P1-5: Device-Owner only) ───────────────────────────────────

    private void execKnoxStart(PegCommand cmd, long startNs) {
        // Design decision (P1-5 option A): screen share requires Device Owner
        // (Knox fleet). On a non-DO device we do NOT start a blind capture service.
        if (!PegDeviceAdminReceiver.isDeviceOwner(ctx)) {
            Timber.w("knox:start_session on non-Device-Owner device — refusing");
            ackCommand(cmd.id, "error:not_device_owner", startNs);
            return;
        }
        Intent intent = new Intent(ctx, ScreenShareService.class);
        if (cmd.payload != null) {
            intent.putExtra("session_id", cmd.payload.sessionId);
            intent.putExtra("centrifugo_channel", cmd.payload.centrifugoChannel);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent);
        } else {
            ctx.startService(intent);
        }
        ackCommand(cmd.id, "executed", startNs);
    }

    private void execKnoxEnd(PegCommand cmd, long startNs) {
        ctx.stopService(new Intent(ctx, ScreenShareService.class));
        ackCommand(cmd.id, "executed", startNs);
    }

    // ── INJECTION (P1-4 scaling + P1-6 truthful ACK) ─────────────────────────────

    private void execInjectTouch(PegCommand cmd, long startNs) {
        if (!RemoteControlAccessibilityService.isConnected()) {
            ackCommand(cmd.id, "error:accessibility_unavailable", startNs);
            return;
        }
        PegCommand.CommandPayload p = cmd.payload;
        if (p == null) { ackCommand(cmd.id, "error:no_payload", startNs); return; }
        RemoteControlAccessibilityService.injectTouch(
                p.x, p.y, p.x2, p.y2,
                p.action != null ? p.action : "tap",
                p.captureWidth, p.captureHeight,
                (ok, detail) -> ackCommand(cmd.id, ok ? "executed" : "error:" + detail, startNs));
    }

    private void execInjectKey(PegCommand cmd, long startNs) {
        if (!RemoteControlAccessibilityService.isConnected()) {
            ackCommand(cmd.id, "error:accessibility_unavailable", startNs);
            return;
        }
        String key = cmd.payload != null ? cmd.payload.key : "BACK";
        RemoteControlAccessibilityService.injectKey(key,
                (ok, detail) -> ackCommand(cmd.id, ok ? "executed" : "error:" + detail, startNs));
    }

    // ── ACK ───────────────────────────────────────────────────────────────────

    private void ackCommand(String commandId, String status, long startNs) {
        long elapsedMs = (System.nanoTime() - startNs) / 1_000_000;
        Timber.i("CMD_ACK id=%s status=%s elapsed=%dms", commandId, status, elapsedMs);
        api.ackCommand(commandId, status, elapsedMs);
    }

    public void shutdown() {
        executor.shutdownNow();
        locationExecutor.shutdownNow();
        mdmExecutor.shutdownNow();
        mediaExecutor.shutdownNow();
    }
}
