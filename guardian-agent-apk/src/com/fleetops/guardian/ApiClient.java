package com.fleetops.guardian;

import android.util.Log;
import org.json.JSONObject;
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

    public static EnrollResult enroll(String serverUrl, String orgToken,
                                      String deviceName, String imei) {
        try {
            JSONObject body = new JSONObject();
            body.put("org_token", orgToken);
            body.put("name", deviceName);
            body.put("imei", imei);
            body.put("model", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL);
            body.put("os_version", android.os.Build.VERSION.RELEASE);
            body.put("app_version", "1.0.0");

            String resp = post(serverUrl + "/api/v1/guardian/enroll", null, body.toString());
            if (resp == null) return new EnrollResult(null, "No response from server");

            JSONObject json = new JSONObject(resp);
            if (json.has("token")) return new EnrollResult(json.getString("token"), null);
            String error = json.optString("error", "Enrollment failed");
            return new EnrollResult(null, error);
        } catch (Exception e) {
            Log.e(TAG, "enroll error", e);
            return new EnrollResult(null, e.getMessage());
        }
    }

    public static boolean heartbeat(String serverUrl, String token,
                                    double lat, double lng, float accuracy,
                                    float speed, int battery, String network) {
        try {
            JSONObject body = new JSONObject();
            body.put("lat", lat);
            body.put("lng", lng);
            body.put("speed", speed);
            body.put("battery_level", battery);
            body.put("network_type", network);
            String resp = post(serverUrl + "/api/v1/guardian/heartbeat", token, body.toString());
            return resp != null;
        } catch (Exception e) {
            Log.e(TAG, "heartbeat error", e);
            return false;
        }
    }

    // mode must be one of: silent, loud, medical, security, hijack
    // lat/lng should be the current GPS position (0,0 only as fallback)
    public static boolean sendPanic(String serverUrl, String token,
                                    String mode, double lat, double lng) {
        if (mode == null || mode.isEmpty()) return true; // cancel is UI-only
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

    public static boolean sendReport(String serverUrl, String token,
                                     String displayCategory, String desc,
                                     double lat, double lng) {
        try {
            JSONObject body = new JSONObject();
            body.put("category", mapCategory(displayCategory));
            body.put("severity", "medium");
            body.put("description", desc);
            body.put("lat", lat);
            body.put("lng", lng);
            String resp = post(serverUrl + "/api/v1/guardian/report", token, body.toString());
            return resp != null;
        } catch (Exception e) {
            Log.e(TAG, "report error", e);
            return false;
        }
    }

    // Maps user-visible labels to the backend's validated enum values
    private static String mapCategory(String display) {
        if (display == null) return "accident";
        switch (display) {
            case "Accident / Incident":  return "accident";
            case "Roadblock / Hazard":   return "roadblock";
            case "Suspicious Activity":  return "suspicious";
            case "Theft":               return "theft";
            case "Attack / Assault":    return "attack";
            case "Medical Emergency":   return "medical";
            case "Checkpoint":          return "checkpoint";
            case "Delivery Issue":      return "delivery_issue";
            case "Vehicle Issue":       return "vehicle_issue";
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
        // Backend deviceAuth middleware reads X-Device-Token header
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
}
