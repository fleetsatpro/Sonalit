package com.fleetops.guardian;

import android.util.Log;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class ApiClient {
    private static final String TAG = "ApiClient";
    private static final int TIMEOUT = 15000;

    public static class EnrollResult {
        public final String token;
        public final String error;
        public EnrollResult(String token, String error) {
            this.token = token;
            this.error = error;
        }
    }

    public static EnrollResult enroll(String serverUrl, String orgToken, String deviceName, String imei) {
        try {
            String body = "{\"org_token\":\"" + esc(orgToken) + "\","
                + "\"name\":\"" + esc(deviceName) + "\","
                + "\"imei\":\"" + esc(imei) + "\","
                + "\"model\":\"" + esc(android.os.Build.MODEL) + "\","
                + "\"os_version\":\"" + esc(android.os.Build.VERSION.RELEASE) + "\","
                + "\"app_version\":\"1.0.0\"}";

            String resp = post(serverUrl + "/api/v1/guardian/enroll", null, body);
            if (resp == null) return new EnrollResult(null, "No response from server");

            String token = extract(resp, "token");
            if (token != null) return new EnrollResult(token, null);
            String error = extract(resp, "error");
            return new EnrollResult(null, error != null ? error : "Enrollment failed");
        } catch (Exception e) {
            Log.e(TAG, "enroll error", e);
            return new EnrollResult(null, e.getMessage());
        }
    }

    public static boolean heartbeat(String serverUrl, String token,
                                    double lat, double lng, float accuracy,
                                    int battery, String network) {
        try {
            String body = "{\"lat\":" + lat + ",\"lng\":" + lng
                + ",\"accuracy\":" + accuracy
                + ",\"battery_level\":" + battery
                + ",\"network_type\":\"" + esc(network) + "\""
                + ",\"speed\":0}";
            String resp = post(serverUrl + "/api/v1/guardian/heartbeat", token, body);
            return resp != null;
        } catch (Exception e) {
            Log.e(TAG, "heartbeat error", e);
            return false;
        }
    }

    // mode must be one of: silent, loud, medical, security, hijack
    // pass null or empty to cancel (just resolves locally — backend keeps the event record)
    public static boolean sendPanic(String serverUrl, String token, String mode) {
        if (mode == null || mode.isEmpty() || mode.equals("cancel")) {
            return true; // cancellation is UI-only; panic record stays in backend for audit
        }
        try {
            String body = "{\"mode\":\"" + esc(mode) + "\",\"lat\":0,\"lng\":0}";
            String resp = post(serverUrl + "/api/v1/guardian/panic", token, body);
            return resp != null;
        } catch (Exception e) {
            Log.e(TAG, "panic error", e);
            return false;
        }
    }

    // category must match backend enum; this method maps display names to backend values
    public static boolean sendReport(String serverUrl, String token, String displayCategory, String desc) {
        try {
            String category = mapCategory(displayCategory);
            String body = "{\"category\":\"" + esc(category) + "\","
                + "\"severity\":\"medium\","
                + "\"description\":\"" + esc(desc) + "\","
                + "\"lat\":0,\"lng\":0}";
            String resp = post(serverUrl + "/api/v1/guardian/report", token, body);
            return resp != null;
        } catch (Exception e) {
            Log.e(TAG, "report error", e);
            return false;
        }
    }

    // Maps user-visible category labels to the backend's valid enum values
    private static String mapCategory(String display) {
        if (display == null) return "accident";
        switch (display) {
            case "Accident / Incident": return "accident";
            case "Roadblock / Hazard":  return "roadblock";
            case "Vehicle Issue":       return "vehicle_issue";
            case "Medical Emergency":   return "medical";
            case "Suspicious Activity": return "suspicious";
            case "Theft / Attack":      return "attack";
            case "Checkpoint":          return "checkpoint";
            default:                    return "accident";
        }
    }

    private static String post(String urlStr, String token, String body) throws Exception {
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(TIMEOUT);
        conn.setReadTimeout(TIMEOUT);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Accept", "application/json");
        // Backend deviceAuth middleware expects X-Device-Token header (not Authorization)
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
        if (is == null) return code >= 200 && code < 300 ? "" : null;

        BufferedReader br = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) sb.append(line);
        br.close();
        conn.disconnect();

        String result = sb.toString();
        Log.d(TAG, "POST " + urlStr + " -> " + code + " " + result);
        return (code >= 200 && code < 300) ? result : null;
    }

    private static String extract(String json, String key) {
        String search = "\"" + key + "\":\"";
        int i = json.indexOf(search);
        if (i < 0) return null;
        int start = i + search.length();
        int end = json.indexOf('"', start);
        if (end < 0) return null;
        return json.substring(start, end);
    }

    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
