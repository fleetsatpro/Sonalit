package com.sonalit.pegagent.network;

import android.content.Context;
import android.location.Location;
import android.os.Build;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.sonalit.pegagent.BuildConfig;
import com.sonalit.pegagent.util.PegConfig;

import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import timber.log.Timber;

/**
 * PegApiClient: REST calls to Sonalit backend.
 *
 * Auth: X-Device-Token header (raw UUID issued by /api/v1/guardian/enroll).
 *
 * Endpoints:
 *   POST /api/v1/guardian/enroll        — device registration (no auth needed)
 *   GET  /api/v1/guardian/whoami        — identity/org backfill (migration)
 *   POST /api/v1/guardian/heartbeat     — telemetry + receive pending commands
 *   POST /api/v1/guardian/location      — immediate location push
 *   POST /api/v1/guardian/ack-command   — command acknowledgement
 *   POST /api/v1/guardian/panic         — SOS alert
 *   POST /api/v1/guardian/panic/cancel  — SOS cancel
 */
public class PegApiClient {

    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    /** Valid server panic modes: silent, loud, medical, security, hijack. */
    public static final String PANIC_MODE_SOS = "security";

    private final Context ctx;
    private final OkHttpClient http;
    private final Gson gson;
    private final ExecutorService bgExecutor;

    public PegApiClient(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.gson = new Gson();
        this.bgExecutor = Executors.newFixedThreadPool(3);

        this.http = new OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(15, TimeUnit.SECONDS)
                .writeTimeout(10, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build();
    }

    // ── Enroll ────────────────────────────────────────────────────────────────

    public static class EnrollResult {
        public String deviceToken;
        public String deviceUuid;
        public String orgId;
        public String officerId;
        public String signingSecret;
    }

    public interface EnrollCallback {
        void onSuccess(EnrollResult result);
        void onFailure(String error);
    }

    /**
     * Enroll a device. No auth token required — call before saveEnrollment().
     * Runs on bgExecutor; callback is NOT dispatched to main thread.
     */
    public void enroll(String serverUrl, String badge, String androidId, EnrollCallback callback) {
        bgExecutor.execute(() -> {
            try {
                // Legacy format so enrollment works even without a backend redeploy.
                JsonObject body = new JsonObject();
                body.addProperty("name",        badge);
                body.addProperty("org_token",   "fleet-guardian-2024");
                body.addProperty("android_id",  androidId);
                body.addProperty("app_version", BuildConfig.VERSION_NAME);

                Request req = new Request.Builder()
                        .url(serverUrl + "/api/v1/guardian/enroll")
                        .post(RequestBody.create(body.toString(), JSON))
                        .build();

                try (Response resp = http.newCall(req).execute()) {
                    String json = resp.body() != null ? resp.body().string() : "";
                    if (resp.isSuccessful() || resp.code() == 202) {
                        JsonObject r = gson.fromJson(json, JsonObject.class);
                        EnrollResult res = new EnrollResult();
                        // Handle v4 { device_token, device_uuid } and legacy { token, device_id }.
                        res.deviceToken = str(r, "device_token", "token");
                        res.deviceUuid  = str(r, "device_uuid", "device_id");
                        res.orgId         = str(r, "org_id", null);
                        res.officerId     = str(r, "officer_id", null);
                        res.signingSecret = str(r, "command_signing_secret", null);
                        if (res.deviceToken != null && res.deviceUuid != null) {
                            callback.onSuccess(res);
                        } else {
                            callback.onFailure("Server returned incomplete enrollment: " + json);
                        }
                    } else {
                        callback.onFailure("HTTP " + resp.code() + ": " + json);
                    }
                }
            } catch (Exception e) {
                callback.onFailure(e.getMessage() != null ? e.getMessage() : "Network error");
            }
        });
    }

    private static String str(JsonObject o, String key, String alt) {
        if (o == null) return null;
        if (o.has(key) && !o.get(key).isJsonNull()) return o.get(key).getAsString();
        if (alt != null && o.has(alt) && !o.get(alt).isJsonNull()) return o.get(alt).getAsString();
        return null;
    }

    // ── Whoami (migration backfill) ───────────────────────────────────────────

    public interface WhoamiCallback { void onResult(String orgId, String officerId); }

    /** Backfill org_id/officer_id for already-enrolled devices after an update. */
    public void fetchWhoami(WhoamiCallback callback) {
        bgExecutor.execute(() -> {
            try {
                String token = PegConfig.getAuthToken(ctx);
                if (token == null) { callback.onResult(null, null); return; }
                Request req = new Request.Builder()
                        .url(PegConfig.getServerUrl(ctx) + "/api/v1/guardian/whoami")
                        .get()
                        .header("X-Device-Token", token)
                        .build();
                try (Response resp = http.newCall(req).execute()) {
                    if (resp.isSuccessful() && resp.body() != null) {
                        JsonObject r = gson.fromJson(resp.body().string(), JsonObject.class);
                        PegConfig.saveCommandSigningSecret(str(r, "command_signing_secret", null));
                        callback.onResult(str(r, "org_id", null), str(r, "officer_id", null));
                        return;
                    }
                }
            } catch (Exception e) {
                Timber.e(e, "whoami failed");
            }
            callback.onResult(null, null);
        });
    }

    // ── Telemetry (heartbeat) ─────────────────────────────────────────────────

    public void sendTelemetry(TelemetryPayload payload) {
        sendTelemetry(payload, null);
    }

    public interface ResultCallback { void onResult(boolean success); }

    public void sendTelemetry(TelemetryPayload payload, CommandPollCallback commandCallback) {
        bgExecutor.execute(() -> {
            try {
                String token = PegConfig.getAuthToken(ctx);
                if (token == null) return;

                Request req = new Request.Builder()
                        .url(PegConfig.getServerUrl(ctx) + "/api/v1/guardian/heartbeat")
                        .post(RequestBody.create(buildHeartbeatBody(payload).toString(), JSON))
                        .header("X-Device-Token", token)
                        .build();

                try (Response resp = http.newCall(req).execute()) {
                    if (resp.isSuccessful() && resp.body() != null) {
                        String json = resp.body().string();
                        Timber.d("Heartbeat OK");
                        handleHeartbeatResponse(json, commandCallback);
                    } else {
                        Timber.w("Heartbeat failed: HTTP %d", resp.code());
                    }
                }
            } catch (IOException e) {
                Timber.e(e, "Heartbeat error");
            }
        });
    }

    /**
     * Force check-in (P1-1): heartbeat round-trip + command drain, reporting real
     * success so the command can ACK truthfully.
     */
    public void performCheckin(TelemetryPayload payload, CommandPollCallback commandCallback,
                               ResultCallback resultCallback) {
        bgExecutor.execute(() -> {
            boolean ok = false;
            try {
                String token = PegConfig.getAuthToken(ctx);
                if (token != null) {
                    Request req = new Request.Builder()
                            .url(PegConfig.getServerUrl(ctx) + "/api/v1/guardian/heartbeat")
                            .post(RequestBody.create(buildHeartbeatBody(payload).toString(), JSON))
                            .header("X-Device-Token", token)
                            .build();
                    try (Response resp = http.newCall(req).execute()) {
                        ok = resp.isSuccessful();
                        if (ok && resp.body() != null) {
                            handleHeartbeatResponse(resp.body().string(), commandCallback);
                        }
                    }
                }
            } catch (Exception e) {
                Timber.e(e, "Force check-in error");
            }
            if (resultCallback != null) resultCallback.onResult(ok);
        });
    }

    private JsonObject buildHeartbeatBody(TelemetryPayload payload) {
        JsonObject body = new JsonObject();
        body.addProperty("battery_pct",      payload.battery_pct);
        body.addProperty("signal_pct",       payload.signal_pct);
        body.addProperty("app_version",      payload.app_version);
        body.addProperty("app_version_code", BuildConfig.VERSION_CODE);
        if (payload.gps_locked) {
            body.addProperty("lat",      payload.gps_lat);
            body.addProperty("lng",      payload.gps_lng);
            body.addProperty("speed",    payload.speed);
            body.addProperty("accuracy", payload.gps_accuracy_m);
        }
        return body;
    }

    /** Extract commands + backfill org_id/signing secret from a heartbeat/poll response. */
    private void handleHeartbeatResponse(String json, CommandPollCallback commandCallback) {
        try {
            JsonObject r = gson.fromJson(json, JsonObject.class);
            if (r == null) return;
            // Silent migration: backfill org_id + signing secret when the server supplies them.
            if (PegConfig.getOrgId(ctx) == null) PegConfig.saveOrgId(str(r, "org_id", null));
            PegConfig.saveCommandSigningSecret(str(r, "command_signing_secret", null));
            if (commandCallback != null && r.has("commands") && !r.get("commands").isJsonNull()) {
                commandCallback.onCommands(r.get("commands").toString());
            }
        } catch (Exception ignored) {}
    }

    // ── Location ──────────────────────────────────────────────────────────────

    public void sendTelemetryNow(Location location) {
        bgExecutor.execute(() -> {
            try {
                String token = PegConfig.getAuthToken(ctx);
                if (token == null) return;

                JsonObject body = new JsonObject();
                body.addProperty("lat",       location.getLatitude());
                body.addProperty("lng",       location.getLongitude());
                body.addProperty("accuracy",  location.getAccuracy());
                body.addProperty("speed",     location.getSpeed());
                body.addProperty("timestamp", new java.util.Date(location.getTime()).toString());

                Request req = new Request.Builder()
                        .url(PegConfig.getServerUrl(ctx) + "/api/v1/guardian/location")
                        .post(RequestBody.create(body.toString(), JSON))
                        .header("X-Device-Token", token)
                        .build();

                try (Response resp = http.newCall(req).execute()) {
                    Timber.d("Location push: HTTP %d", resp.code());
                }
            } catch (IOException e) {
                Timber.e(e, "Location push error");
            }
        });
    }

    // ── Command ACK ───────────────────────────────────────────────────────────

    /** ACK a command. Server accepts status "executed"/"failed"; detail goes in result. */
    public void ackCommand(String commandId, String status, long latencyMs) {
        bgExecutor.execute(() -> {
            try {
                String token = PegConfig.getAuthToken(ctx);
                if (token == null) return;

                boolean executed = "executed".equals(status) || "pong".equals(status);
                JsonObject body = new JsonObject();
                body.addProperty("command_id", commandId);
                body.addProperty("status",     executed ? "executed" : "failed");
                body.addProperty("result",     status);

                Request req = new Request.Builder()
                        .url(PegConfig.getServerUrl(ctx) + "/api/v1/guardian/ack-command")
                        .post(RequestBody.create(body.toString(), JSON))
                        .header("X-Device-Token", token)
                        .build();

                try (Response resp = http.newCall(req).execute()) {
                    Timber.d("ACK cmd=%s status=%s HTTP=%d", commandId, status, resp.code());
                }
            } catch (IOException e) {
                Timber.e(e, "ACK failed for cmd=%s", commandId);
            }
        });
    }

    // ── Poll (heartbeat fallback) ─────────────────────────────────────────────

    /** Poll command queue via heartbeat (fallback when WebSocket is down). */
    public void pollCommands(CommandPollCallback callback) {
        bgExecutor.execute(() -> {
            try {
                String token = PegConfig.getAuthToken(ctx);
                if (token == null) return;

                JsonObject body = new JsonObject();
                body.addProperty("app_version_code", BuildConfig.VERSION_CODE);

                Request req = new Request.Builder()
                        .url(PegConfig.getServerUrl(ctx) + "/api/v1/guardian/heartbeat")
                        .post(RequestBody.create(body.toString(), JSON))
                        .header("X-Device-Token", token)
                        .build();

                try (Response resp = http.newCall(req).execute()) {
                    if (resp.isSuccessful() && resp.body() != null) {
                        handleHeartbeatResponse(resp.body().string(), callback);
                    }
                }
            } catch (IOException e) {
                Timber.e(e, "Command poll error");
            }
        });
    }

    // ── SOS ───────────────────────────────────────────────────────────────────

    public interface PanicCallback { void onResult(boolean success, int httpCode); }

    /**
     * Fire a panic/SOS event. The result callback (success = 2xx) makes the SOS
     * button state authoritative.
     */
    public void sendPanic(double lat, double lng, String mode, String source,
                          boolean gpsStale, PanicCallback callback) {
        bgExecutor.execute(() -> {
            try {
                String token = PegConfig.getAuthToken(ctx);
                if (token == null) { if (callback != null) callback.onResult(false, 0); return; }

                JsonObject body = new JsonObject();
                body.addProperty("lat",       lat);
                body.addProperty("lng",       lng);
                body.addProperty("mode",      mode != null ? mode : PANIC_MODE_SOS);
                if (source != null) body.addProperty("source", source);
                if (gpsStale) body.addProperty("gps_stale", true);

                Request req = new Request.Builder()
                        .url(PegConfig.getServerUrl(ctx) + "/api/v1/guardian/panic")
                        .post(RequestBody.create(body.toString(), JSON))
                        .header("X-Device-Token", token)
                        .header("Idempotency-Key", java.util.UUID.randomUUID().toString())
                        .build();

                try (Response resp = http.newCall(req).execute()) {
                    boolean ok = resp.isSuccessful();
                    Timber.i("Panic sent: HTTP %d ok=%b", resp.code(), ok);
                    if (callback != null) callback.onResult(ok, resp.code());
                }
            } catch (IOException e) {
                Timber.e(e, "Panic send error");
                if (callback != null) callback.onResult(false, 0);
            }
        });
    }

    /** Cancel this device's active SOS. */
    public void sendPanicCancel(PanicCallback callback) {
        bgExecutor.execute(() -> {
            try {
                String token = PegConfig.getAuthToken(ctx);
                if (token == null) { if (callback != null) callback.onResult(false, 0); return; }

                Request req = new Request.Builder()
                        .url(PegConfig.getServerUrl(ctx) + "/api/v1/guardian/panic/cancel")
                        .post(RequestBody.create("{}", JSON))
                        .header("X-Device-Token", token)
                        .build();

                try (Response resp = http.newCall(req).execute()) {
                    boolean ok = resp.isSuccessful();
                    Timber.i("Panic cancel: HTTP %d", resp.code());
                    if (callback != null) callback.onResult(ok, resp.code());
                }
            } catch (IOException e) {
                Timber.e(e, "Panic cancel error");
                if (callback != null) callback.onResult(false, 0);
            }
        });
    }

    public void shutdown() {
        bgExecutor.shutdownNow();
        http.dispatcher().executorService().shutdown();
    }

    public interface CommandPollCallback {
        void onCommands(String json);
    }

    // ── Telemetry payload ─────────────────────────────────────────────────────

    public static class TelemetryPayload {
        public int battery_pct;
        public int signal_pct;
        public boolean gps_locked;
        public double gps_lat;
        public double gps_lng;
        public float gps_accuracy_m;
        public float speed;
        public int gps_satellites;
        public int cpu_pct;
        public int ram_pct;
        public String app_version;
        public String android_version;

        public static TelemetryPayload build(Context ctx, Location loc, int signalPct) {
            TelemetryPayload p = new TelemetryPayload();
            p.android_version = Build.VERSION.RELEASE;
            p.app_version     = BuildConfig.VERSION_NAME;

            if (loc != null) {
                p.gps_locked     = true;
                p.gps_lat        = loc.getLatitude();
                p.gps_lng        = loc.getLongitude();
                p.gps_accuracy_m = loc.getAccuracy();
                p.speed          = loc.getSpeed();
            }
            p.battery_pct = getBatteryPct(ctx);
            p.signal_pct  = signalPct;
            p.cpu_pct     = getCpuPct();
            p.ram_pct     = getRamPct(ctx);
            return p;
        }

        private static int getBatteryPct(Context ctx) {
            android.content.Intent battIntent = ctx.registerReceiver(null,
                    new android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED));
            if (battIntent == null) return -1;
            int level = battIntent.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1);
            int scale = battIntent.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1);
            return (scale > 0) ? (int)((level / (float)scale) * 100) : -1;
        }

        private static int getCpuPct() {
            try {
                java.io.RandomAccessFile reader = new java.io.RandomAccessFile("/proc/stat", "r");
                String load = reader.readLine();
                reader.close();
                String[] toks = load.split(" ");
                long idle1  = Long.parseLong(toks[5]);
                long cpu1   = Long.parseLong(toks[2]) + Long.parseLong(toks[3])
                            + Long.parseLong(toks[4]) + idle1
                            + Long.parseLong(toks[6]) + Long.parseLong(toks[7])
                            + Long.parseLong(toks[8]);
                return (int)(100 - (idle1 * 100 / cpu1));
            } catch (Exception e) {
                return -1;
            }
        }

        private static int getRamPct(Context ctx) {
            android.app.ActivityManager am =
                    (android.app.ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            android.app.ActivityManager.MemoryInfo mi = new android.app.ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            long totalMem = mi.totalMem;
            long availMem = mi.availMem;
            if (totalMem == 0) return -1;
            return (int)(((totalMem - availMem) * 100) / totalMem);
        }
    }
}
