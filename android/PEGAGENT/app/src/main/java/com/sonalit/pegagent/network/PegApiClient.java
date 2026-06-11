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
 * - Telemetry PATCH on 30s heartbeat + immediate on location request
 * - Command ACK POST
 * - Enrollment
 * All calls are fire-and-forget on background executor - never blocks calling thread.
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

    /** Send telemetry heartbeat. Non-blocking. */
    public void sendTelemetry(TelemetryPayload payload) {
        bgExecutor.execute(() -> {
            try {
                String deviceId = PegConfig.getDeviceId(ctx);
                String url = PegConfig.getServerUrl(ctx)
                        + "/api/guardian/devices/" + deviceId + "/telemetry";

                String body = gson.toJson(payload);
                Request req = new Request.Builder()
                        .url(url)
                        .patch(RequestBody.create(body, JSON))
                        .header("Authorization", "Bearer " + PegConfig.getAuthToken(ctx))
                        .header("Content-Type", "application/json")
                        .build();

                try (Response resp = http.newCall(req).execute()) {
                    if (!resp.isSuccessful()) {
                        Timber.w("Telemetry failed: HTTP %d", resp.code());
                    } else {
                        Timber.d("Telemetry sent OK");
                    }
                }
            } catch (IOException e) {
                Timber.e(e, "Telemetry send error");
            }
        });
    }

    /** Force-send telemetry immediately with current location (for request_location command). */
    public void sendTelemetryNow(Location location) {
        bgExecutor.execute(() -> {
            try {
                String deviceId = PegConfig.getDeviceId(ctx);
                String url = PegConfig.getServerUrl(ctx)
                        + "/api/guardian/devices/" + deviceId + "/telemetry";

                JsonObject body = new JsonObject();
                body.addProperty("gps_locked", true);
                body.addProperty("gps_lat", location.getLatitude());
                body.addProperty("gps_lng", location.getLongitude());
                body.addProperty("gps_accuracy_m", location.getAccuracy());
                body.addProperty("trigger", "request_location");

                Request req = new Request.Builder()
                        .url(url)
                        .patch(RequestBody.create(body.toString(), JSON))
                        .header("Authorization", "Bearer " + PegConfig.getAuthToken(ctx))
                        .build();

                try (Response resp = http.newCall(req).execute()) {
                    Timber.d("Location telemetry: HTTP %d", resp.code());
                }
            } catch (IOException e) {
                Timber.e(e, "Location telemetry error");
            }
        });
    }

    /** ACK a command back to the server with status and execution latency. */
    public void ackCommand(String commandId, String status, long latencyMs) {
        bgExecutor.execute(() -> {
            try {
                String url = PegConfig.getServerUrl(ctx) + "/api/guardian/commands/" + commandId + "/ack";

                JsonObject body = new JsonObject();
                body.addProperty("status", status);
                body.addProperty("acked_at", System.currentTimeMillis());
                body.addProperty("latency_ms", latencyMs);
                body.addProperty("device_id", PegConfig.getDeviceId(ctx));

                Request req = new Request.Builder()
                        .url(url)
                        .post(RequestBody.create(body.toString(), JSON))
                        .header("Authorization", "Bearer " + PegConfig.getAuthToken(ctx))
                        .build();

                try (Response resp = http.newCall(req).execute()) {
                    Timber.d("ACK cmd=%s status=%s HTTP=%d", commandId, status, resp.code());
                }
            } catch (IOException e) {
                Timber.e(e, "ACK failed for cmd=%s", commandId);
            }
        });
    }

    /** Poll command queue (fallback when WebSocket is down). */
    public void pollCommands(CommandPollCallback callback) {
        bgExecutor.execute(() -> {
            try {
                String deviceId = PegConfig.getDeviceId(ctx);
                String url = PegConfig.getServerUrl(ctx)
                        + "/api/guardian/devices/" + deviceId + "/commands/pending";

                Request req = new Request.Builder()
                        .url(url)
                        .get()
                        .header("Authorization", "Bearer " + PegConfig.getAuthToken(ctx))
                        .build();

                try (Response resp = http.newCall(req).execute()) {
                    if (resp.isSuccessful() && resp.body() != null) {
                        String json = resp.body().string();
                        callback.onCommands(json);
                    }
                }
            } catch (IOException e) {
                Timber.e(e, "Command poll error");
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

    /** Telemetry payload - matches backend PATCH /telemetry contract */
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
        public String knox_version = "3.8";

        public static TelemetryPayload build(Context ctx, Location loc) {
            TelemetryPayload p = new TelemetryPayload();
            p.android_version = Build.VERSION.RELEASE;
            p.app_version     = getAppVersion(ctx);

            if (loc != null) {
                p.gps_locked    = true;
                p.gps_lat       = loc.getLatitude();
                p.gps_lng       = loc.getLongitude();
                p.gps_accuracy_m = loc.getAccuracy();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    p.gps_satellites = 0; // requires NMEA listener for exact count
                }
            }
            p.battery_pct = getBatteryPct(ctx);
            p.signal_pct  = getSignalPct(ctx);
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

        private static int getSignalPct(Context ctx) {
            android.telephony.TelephonyManager tm =
                    (android.telephony.TelephonyManager) ctx.getSystemService(Context.TELEPHONY_SERVICE);
            // Map signal strength: Android returns 0-4 bars
            // We convert to 0-100 percentage
            return -1; // Requires ASU listener, handled by TelemetryService
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
