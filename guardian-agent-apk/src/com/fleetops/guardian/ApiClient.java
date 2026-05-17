package com.fleetops.guardian;

import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public class ApiClient {
    private static final String TAG     = "ApiClient";
    private static final int    TIMEOUT = 15_000;

    // ── Enroll ───────────────────────────────────────────────────────────────

    public static class EnrollResult {
        public final String token;
        public final String error;
        public EnrollResult(String token, String error) {
            this.token = token; this.error = error;
        }
    }

    public static EnrollResult enroll(String serverUrl, String orgToken,
                                      String deviceName, String imei) {
        try {
            JSONObject body = new JSONObject();
            body.put("org_token", orgToken);
            body.put("name", deviceName);
            body.put("imei", imei);
            body.put("model", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL);
            body.put("os_version", android.os.Build.VERSION.RELEASE);
            body.put("app_version", APP_VERSION);

            String resp = post(serverUrl + "/api/v1/guardian/enroll", null, body.toString());
            if (resp == null) return new EnrollResult(null, "No response from server");
            JSONObject json = new JSONObject(resp);
            if (json.has("token")) return new EnrollResult(json.getString("token"), null);
            return new EnrollResult(null, json.optString("error", "Enrollment failed"));
        } catch (Exception e) {
            Log.e(TAG, "enroll error", e);
            return new EnrollResult(null, e.getMessage());
        }
    }

    // ── Heartbeat — returns pending commands ──────────────────────────────────

    static final String APP_VERSION      = "2.2.0";
    static final int    APP_VERSION_CODE = 4;

    public static class PendingCommand {
        public final String id;
        public final String type;
        public final String payload;
        public PendingCommand(String id, String type, String payload) {
            this.id = id; this.type = type; this.payload = payload;
        }
    }

    public static class HeartbeatResult {
        public final boolean upgradeRequired;
        public final int     minVersionCode;
        public final String  downloadUrl;
        public final List<PendingCommand> commands;
        HeartbeatResult(List<PendingCommand> commands) {
            this.upgradeRequired = false;
            this.minVersionCode  = 0;
            this.downloadUrl     = null;
            this.commands        = commands;
        }
        HeartbeatResult(int minVersionCode, String downloadUrl) {
            this.upgradeRequired = true;
            this.minVersionCode  = minVersionCode;
            this.downloadUrl     = downloadUrl;
            this.commands        = new ArrayList<>();
        }
    }

    public static HeartbeatResult heartbeat(String serverUrl, String token,
                                            double lat, double lng, float accuracy,
                                            float speed, int battery, String network) {
        List<PendingCommand> commands = new ArrayList<>();
        try {
            JSONObject body = new JSONObject();
            body.put("lat", lat);
            body.put("lng", lng);
            body.put("speed", speed);
            body.put("battery_level", battery);
            body.put("network_type", network);
            body.put("app_version", APP_VERSION);
            body.put("app_version_code", APP_VERSION_CODE);
            RawResponse raw = postRaw(serverUrl + "/api/v1/guardian/heartbeat", token, body.toString());
            if (raw == null) return new HeartbeatResult(commands);
            if (raw.status == 426) {
                JSONObject json = new JSONObject(raw.body);
                return new HeartbeatResult(
                    json.optInt("min_version_code", 0),
                    json.optString("download_url", serverUrl + "/api/v1/guardian/apk/download")
                );
            }
            if (raw.status >= 200 && raw.status < 300 && raw.body != null && !raw.body.isEmpty()) {
                JSONObject json = new JSONObject(raw.body);
                JSONArray arr = json.optJSONArray("commands");
                if (arr != null) {
                    for (int i = 0; i < arr.length(); i++) {
                        JSONObject cmd = arr.getJSONObject(i);
                        JSONObject pl  = cmd.optJSONObject("payload");
                        commands.add(new PendingCommand(
                            cmd.optString("id"),
                            cmd.optString("command_type"),
                            pl != null ? pl.toString() : null
                        ));
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "heartbeat error", e);
        }
        return new HeartbeatResult(commands);
    }

    // ── Panic ─────────────────────────────────────────────────────────────────

    public static boolean sendPanic(String serverUrl, String token,
                                    String mode, double lat, double lng) {
        if (mode == null || mode.isEmpty()) return true;
        try {
            JSONObject body = new JSONObject();
            body.put("mode", mode);
            body.put("lat", lat);
            body.put("lng", lng);
            String resp = post(serverUrl + "/api/v1/guardian/panic", token, body.toString());
            return resp != null;
        } catch (Exception e) {
            Log.e(TAG, "panic error", e);
            return false;
        }
    }

    // ── Report ────────────────────────────────────────────────────────────────

    public static boolean sendReport(String serverUrl, String token,
                                     String displayCategory, String desc,
                                     double lat, double lng, String photoBase64) {
        try {
            JSONObject body = new JSONObject();
            body.put("category", mapCategory(displayCategory));
            body.put("severity", "medium");
            body.put("description", desc);
            body.put("lat", lat);
            body.put("lng", lng);
            if (photoBase64 != null && !photoBase64.isEmpty()) {
                body.put("photo_url", "data:image/jpeg;base64," + photoBase64);
            }
            String resp = post(serverUrl + "/api/v1/guardian/report", token, body.toString());
            return resp != null;
        } catch (Exception e) {
            Log.e(TAG, "report error", e);
            return false;
        }
    }

    // ── Location (immediate post, used by request_location command) ──────────

    public static boolean sendLocation(String serverUrl, String token,
                                       double lat, double lng, double altitude,
                                       float bearing, float speed, float accuracy) {
        try {
            JSONObject body = new JSONObject();
            body.put("lat", lat);
            body.put("lng", lng);
            body.put("altitude", altitude);
            body.put("heading", bearing);
            body.put("speed", speed);
            body.put("accuracy", accuracy);
            String resp = post(serverUrl + "/api/v1/guardian/location", token, body.toString());
            return resp != null;
        } catch (Exception e) {
            Log.e(TAG, "sendLocation error", e);
            return false;
        }
    }

    // ── Dead man's switch check-in ────────────────────────────────────────────

    public static boolean checkin(String serverUrl, String token) {
        try {
            String resp = post(serverUrl + "/api/v1/guardian/checkin", token, "{}");
            return resp != null;
        } catch (Exception e) {
            Log.e(TAG, "checkin error", e);
            return false;
        }
    }

    // ── Command ACK ───────────────────────────────────────────────────────────

    public static boolean ackCommand(String serverUrl, String token,
                                     String commandId, boolean success, String result) {
        try {
            JSONObject body = new JSONObject();
            body.put("command_id", commandId);
            body.put("status", success ? "executed" : "failed");
            if (result != null) body.put("result", result);
            String resp = post(serverUrl + "/api/v1/guardian/ack-command", token, body.toString());
            return resp != null;
        } catch (Exception e) {
            Log.e(TAG, "ackCommand error", e);
            return false;
        }
    }

    // ── Convoy ────────────────────────────────────────────────────────────────

    public static boolean joinConvoy(String serverUrl, String token, String convoyCode) {
        try {
            JSONObject body = new JSONObject();
            body.put("convoy_code", convoyCode);
            String resp = post(serverUrl + "/api/v1/guardian/convoy/join", token, body.toString());
            return resp != null;
        } catch (Exception e) {
            Log.e(TAG, "joinConvoy error", e);
            return false;
        }
    }

    public static boolean leaveConvoy(String serverUrl, String token) {
        try {
            String resp = post(serverUrl + "/api/v1/guardian/convoy/leave", token, "{}");
            return resp != null;
        } catch (Exception e) {
            Log.e(TAG, "leaveConvoy error", e);
            return false;
        }
    }

    // ── Category mapping ──────────────────────────────────────────────────────

    private static String mapCategory(String display) {
        if (display == null) return "accident";
        if ("Accident / Incident".equals(display))  return "accident";
        if ("Roadblock / Hazard".equals(display))   return "roadblock";
        if ("Suspicious Activity".equals(display))  return "suspicious";
        if ("Theft".equals(display))                return "theft";
        if ("Attack / Assault".equals(display))     return "attack";
        if ("Medical Emergency".equals(display))    return "medical";
        if ("Checkpoint".equals(display))           return "checkpoint";
        if ("Delivery Issue".equals(display))       return "delivery_issue";
        if ("Vehicle Issue".equals(display))        return "vehicle_issue";
        return "accident";
    }

    // ── HTTP ──────────────────────────────────────────────────────────────────

    static class RawResponse {
        final int    status;
        final String body;
        RawResponse(int status, String body) { this.status = status; this.body = body; }
    }

    static RawResponse postRaw(String urlStr, String token, String body) throws Exception {
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(TIMEOUT);
        conn.setReadTimeout(TIMEOUT);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Accept", "application/json");
        if (token != null && !token.isEmpty()) conn.setRequestProperty("X-Device-Token", token);
        conn.setDoOutput(true);
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        conn.setFixedLengthStreamingMode(bytes.length);
        OutputStream os = conn.getOutputStream();
        os.write(bytes); os.flush(); os.close();
        int code = conn.getResponseCode();
        InputStream is = (code < 400) ? conn.getInputStream() : conn.getErrorStream();
        String result = "";
        if (is != null) {
            BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            br.close();
            result = sb.toString();
        }
        conn.disconnect();
        Log.d(TAG, "POST " + urlStr + " → " + code);
        return new RawResponse(code, result);
    }

    static String post(String urlStr, String token, String body) throws Exception {
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(TIMEOUT);
        conn.setReadTimeout(TIMEOUT);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Accept", "application/json");
        if (token != null && !token.isEmpty()) {
            conn.setRequestProperty("X-Device-Token", token);
        }
        conn.setDoOutput(true);

        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        conn.setFixedLengthStreamingMode(bytes.length);
        OutputStream os = conn.getOutputStream();
        os.write(bytes);
        os.flush();
        os.close();

        int code = conn.getResponseCode();
        InputStream is = (code >= 200 && code < 300)
            ? conn.getInputStream() : conn.getErrorStream();
        if (is == null) return (code >= 200 && code < 300) ? "" : null;

        BufferedReader br = new BufferedReader(
            new InputStreamReader(is, StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) sb.append(line);
        br.close();
        conn.disconnect();

        String result = sb.toString();
        Log.d(TAG, "POST " + urlStr + " → " + code);
        return (code >= 200 && code < 300) ? result : null;
    }
}
