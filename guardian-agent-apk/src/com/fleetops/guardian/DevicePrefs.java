package com.fleetops.guardian;

import android.content.Context;
import android.content.SharedPreferences;

public class DevicePrefs {
    private static final String PREFS = "guardian_prefs";
    private static final String KEY_TOKEN = "device_token";
    private static final String KEY_SERVER = "server_url";
    private static final String KEY_NAME = "device_name";
    private static final String KEY_ENROLLED = "enrolled";

    private final SharedPreferences prefs;

    public DevicePrefs(Context ctx) {
        prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public boolean isEnrolled() {
        return prefs.getBoolean(KEY_ENROLLED, false);
    }

    public void saveEnrollment(String serverUrl, String token, String deviceName) {
        prefs.edit()
            .putString(KEY_SERVER, serverUrl)
            .putString(KEY_TOKEN, token)
            .putString(KEY_NAME, deviceName)
            .putBoolean(KEY_ENROLLED, true)
            .apply();
    }

    public void clearEnrollment() {
        prefs.edit().clear().apply();
    }

    public String getToken() { return prefs.getString(KEY_TOKEN, ""); }
    public String getServerUrl() { return prefs.getString(KEY_SERVER, ""); }
    public String getDeviceName() { return prefs.getString(KEY_NAME, "Guardian Device"); }
}
