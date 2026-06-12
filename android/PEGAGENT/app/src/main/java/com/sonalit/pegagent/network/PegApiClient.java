package com.sonalit.pegagent.network;

import android.content.Context;
import android.location.Location;
import android.os.Build;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
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
 *   POST /api/v1/guardian/enroll       — device registration (no auth needed)
 *   POST /api/v1/guardian/heartbeat    — telemetry + receive pending commands
 *   POST /api/v1/guardian/location     — immediate location push
 *   POST /api/v1/guardian/ack-command  — command acknowledgement
 *   POST /api/v1/guardian/panic        — SOS alert
 */
public class PegApiClient {

    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

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

    public interface EnrollCallback {
        void onSuccess(String deviceToken, String deviceUuid);
        void onFailure(String error);
    }

    /**
     * Enroll a device. No auth token required — call before saveEnrollment().
     * Runs on bgExecutor; callback is NOT dispatched to main thread.
     */
    public void enroll(String serverUrl, String badge, String androidId, EnrollCallback callback) {
        bgExecutor.execute(() -> {
            try {
                JsonObject body = new JsonObject();
                body.addProperty("device_id", androidId);
                body.addProperty("operator_code", badge);
                body.addProperty("platform", "android");
                body.addProperty("app_version", "1.0.11");

                Request req = new Request.Builder()
                        .url(serverUrl + "/api/v1/guardian/enroll")
                        .post(RequestBody.create(body.toString(), JSON))
                        .build();

                try (Response resp = http.newCall(req).execute()) {
                    String json = resp.body() != null ? resp.body().string() : "";
                    if (resp.isSuccessful() || resp.code() == 202) {
                        JsonObject result = gson.fromJson(json, JsonObject.class);
                        String token = result.has("device_token") ? result.get("device_token").getAsString() : null;
                        String uuid  = result.has("device_uuid")  ? result.get("device_uuid").getAsString()  : null;
                        if (token != null && uuid != null) {
                            callback.onSuccess(token, uuid);
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

    // ── Telemetry (heartbeat) ─────────────────────────────────────────────────

    /** Send telemetry heartbeat. Non-blocking. Returns pending commands via callback (may be null). */
    public void sendTelemetry(TelemetryPayload payload) {
        sendTelemetry(payload, null);
    }

    public void sendTelemetry(TelemetryPayload payload, CommandPollCallback commandCallback) {
        bgExecutor.execute(() -> {
            try {
                String token = PegConfig.getAuthToken(ctx);
                if (token == null) return;

                JsonObject body = new JsonObject();
                body.addProperty("battery_pct",      payload.battery_pct);
                body.addProperty("signal_strength",  payload.signal_pct);
                body.addProperty("app_version",      payload.app_version);
                body.addProperty("app_version_code", 10);
                if (payload.gps_locked) {
                    body.addProperty("lat",   payload.gps_lat);
                    body.addProperty("lng",   payload.gps_lng);
                    body.addProperty("speed", 0.0);
                }

                Request req = new Request.Builder()
                        .url(PegConfig.getServerUrl(ctx) + "/api/v1/guardian/heartbeat")
                        .post(RequestBody.create(body.toString(), JSON))
                        .header("X-Device-Token", token)
                        .build();

                try (Response resp = http.newCall(req).execute()) {
                    if (resp.isSuccessful() && resp.body() != null) {
                        String json = resp.body().string();
                        Timber.d("Heartbeat OK");
                        if (commandCallback != null) {
                            // Extract commands array from { commands: [...] }
                            try {
                                JsonObject r = gson.fromJson(json, JsonObject.class);
                                if (r.has("commands")) {
                                    commandCallback.onCommands(r.get("commands").toString());
                                }
                            } catch (Exception ignored) {}
                        }
                    } else {
                        Timber.w("Heartbeat failed: HTTP %d", resp.code());
                    }
                }
            } catch (IOException e) {
                Timber.e(e, "Heartbeat error");
            }
        });
    }

    // ── Location ──────────────────────────────────────────────────────────────

    /** Push a fresh location immediately (e.g. triggered by request_location command). */
    public void sendTelemetryNow(Location location) {
        bgExecutor.execute(() -> {
            try {
                String token = PegConfig.getAuthToken(ctx);
                if (token == null) return;

                JsonObject body = new JsonObject();
                body.addProperty("lat",      location.getLatitude());
                body.addProperty("lng",      location.getLongitude());
                body.addProperty("accuracy", location.getAccuracy());
                body.addProperty("speed",    location.getSpeed());
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

    /** ACK a command back to the server. */
    public void ackCommand(String commandId, String status, long latencyMs) {
        bgExecutor.execute(() -> {
            try {
                String token = PegConfig.getAuthToken(ctx);
                if (token == null) return;

                JsonObject body = new JsonObject();
                body.addProperty("command_id", commandId);
                body.addProperty("status",     status.equals("executed") || status.equals("failed") ? status : "executed");
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
                body.addProperty("app_version_code", 10);

                Request req = new Request.Builder()
                        .url(PegConfig.getServerUrl(ctx) + "/api/v1/guardian/heartbeat")
                        .post(RequestBody.create(body.toString(), JSON))
                        .header("X-Device-Token", token)
                        .build();

                try (Response resp = http.newCall(req).execute()) {
                    if (resp.isSuccessful() && resp.body() != null) {
                        String json = resp.body().string();
                        try {
                            JsonObject r = gson.fromJson(json, JsonObject.class);
                            if (r.has("commands")) {
                                callback.onCommands(r.get("commands").toString());
                            }
                        } catch (Exception ignored) {}
                    }
                }
            } catch (IOException e) {
                Timber.e(e, "Command poll error");
            }
        });
    }

    // ── SOS ───────────────────────────────────────────────────────────────────

    /** Fire a panic/SOS event. */
    public void sendPanic(double lat, double lng, String mode) {
        bgExecutor.execute(() -> {
            try {
                String token = PegConfig.getAuthToken(ctx);
                if (token == null) return;

                JsonObject body = new JsonObject();
                body.addProperty("lat",  lat);
                body.addProperty("lng",  lng);
                body.addProperty("mode", mode);

                Request req = new Request.Builder()
                        .url(PegConfig.getServerUrl(ctx) + "/api/v1/guardian/panic")
                        .post(RequestBody.create(body.toString(), JSON))
                        .header("X-Device-Token", token)
                        .header("Idempotency-Key", java.util.UUID.randomUUID().toString())
                        .build();

                try (Response resp = http.newCall(req).execute()) {
                    Timber.i("Panic sent: HTTP %d", resp.code());
                }
            } catch (IOException e) {
                Timber.e(e, "Panic send error");
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
        public int gps_satellites;
        public int cpu_pct;
        public int ram_pct;
        public String app_version;
        public String android_version;

        public static TelemetryPayload build(Context ctx, Location loc) {
            TelemetryPayload p = new TelemetryPayload();
            p.android_version = Build.VERSION.RELEASE;
            p.app_version     = getAppVersion(ctx);

            if (loc != null) {
                p.gps_locked    = true;
                p.gps_lat       = loc.getLatitude();
                p.gps_lng       = loc.getLongitude();
                p.gps_accuracy_m = loc.getAccuracy();
            }
            p.battery_pct = getBatteryPct(ctx);
            p.signal_pct  = 0;
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

        private static String getAppVersion(Context ctx) {
            try {
                return ctx.getPackageManager()
                        .getPackageInfo(ctx.getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "unknown";
            }
        }
    }
}
