package com.sonalit.pegagent.util;

import android.content.Context;
import android.provider.Settings;

public class PegConfig {

    // Keys stored in SecureStore
    private static final String KEY_SERVER_URL  = "server_url";
    private static final String KEY_ORG_ID      = "org_id";
    private static final String KEY_DEVICE_ID   = "device_id";
    private static final String KEY_AUTH_TOKEN   = "auth_token";
    private static final String KEY_WS_TOKEN    = "ws_token";
    private static final String KEY_BADGE       = "officer_badge";
    private static final String KEY_OFFICER_ID  = "officer_id";
    private static final String KEY_ENROLLED    = "enrolled";

    // Telemetry interval: 30 seconds
    public static final long TELEMETRY_INTERVAL_MS = 30_000L;

    // Command poll fallback interval (WebSocket preferred): 5 seconds
    public static final long CMD_POLL_INTERVAL_MS = 5_000L;

    // WebSocket reconnect: 2 seconds base, exponential backoff to 30s
    public static final long WS_RECONNECT_BASE_MS  = 2_000L;
    public static final long WS_RECONNECT_MAX_MS   = 30_000L;

    // Location: high accuracy, 10 second intervals
    public static final long LOCATION_INTERVAL_MS  = 10_000L;
    public static final long LOCATION_FASTEST_MS   = 5_000L;
    public static final float LOCATION_MIN_DISTANCE = 5.0f; // meters

    public static String getServerUrl(Context ctx) {
        String val = SecureStore.get(KEY_SERVER_URL);
        return val != null ? val : "https://api.sonalit.com";
    }

    public static String getWsUrl(Context ctx) {
        String base = getServerUrl(ctx).replace("https://", "wss://").replace("http://", "ws://");
        return base + "/connection/websocket";
    }

    public static String getOrgId(Context ctx) {
        return SecureStore.get(KEY_ORG_ID);
    }

    public static String getDeviceId(Context ctx) {
        String stored = SecureStore.get(KEY_DEVICE_ID);
        if (stored != null) return stored;
        // Fallback to Android ID
        return Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ANDROID_ID);
    }

    public static String getAuthToken(Context ctx) {
        return SecureStore.get(KEY_AUTH_TOKEN);
    }

    public static String getWsToken(Context ctx) {
        return SecureStore.get(KEY_WS_TOKEN);
    }

    public static String getOfficerBadge(Context ctx) {
        return SecureStore.get(KEY_BADGE);
    }

    public static String getOfficerId(Context ctx) {
        return SecureStore.get(KEY_OFFICER_ID);
    }

    public static boolean isEnrolled(Context ctx) {
        return "true".equals(SecureStore.get(KEY_ENROLLED));
    }

    public static void saveEnrollment(String serverUrl, String orgId, String deviceId,
                                       String authToken, String wsToken,
                                       String badge, String officerId) {
        SecureStore.put(KEY_SERVER_URL, serverUrl);
        SecureStore.put(KEY_ORG_ID, orgId);
        SecureStore.put(KEY_DEVICE_ID, deviceId);
        SecureStore.put(KEY_AUTH_TOKEN, authToken);
        SecureStore.put(KEY_WS_TOKEN, wsToken);
        SecureStore.put(KEY_BADGE, badge);
        SecureStore.put(KEY_OFFICER_ID, officerId);
        SecureStore.put(KEY_ENROLLED, "true");
    }

    public static void saveWsToken(String token) {
        SecureStore.put(KEY_WS_TOKEN, token);
    }

    public static void clearAll() {
        SecureStore.clearAll();
    }
}
