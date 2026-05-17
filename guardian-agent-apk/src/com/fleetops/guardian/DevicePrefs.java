package com.fleetops.guardian;

import android.content.Context;
import android.content.SharedPreferences;

public class DevicePrefs {
    private static final String PREFS = "guardian_prefs";

    private static final String KEY_TOKEN          = "device_token";
    private static final String KEY_SERVER         = "server_url";
    private static final String KEY_NAME           = "device_name";
    private static final String KEY_ENROLLED       = "enrolled";
    private static final String KEY_PANIC_PIN      = "panic_pin";
    private static final String KEY_DMS_ENABLED    = "dms_enabled";
    private static final String KEY_DMS_INTERVAL   = "dms_interval_min";
    private static final String KEY_CONVOY_CODE    = "convoy_code";
    private static final String KEY_UNREAD_MSGS    = "unread_messages";

    private final SharedPreferences prefs;

    public DevicePrefs(Context ctx) {
        prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ── Enrollment ───────────────────────────────────────────────────────────

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

    public String getToken()      { return prefs.getString(KEY_TOKEN, ""); }
    public String getServerUrl()  { return prefs.getString(KEY_SERVER, ""); }
    public String getDeviceName() { return prefs.getString(KEY_NAME, "Guardian Device"); }

    // ── Panic PIN ────────────────────────────────────────────────────────────

    public String getPanicPin()          { return prefs.getString(KEY_PANIC_PIN, ""); }
    public void   setPanicPin(String pin){ prefs.edit().putString(KEY_PANIC_PIN, pin).apply(); }

    // ── Dead Man's Switch ────────────────────────────────────────────────────

    public boolean isDmsEnabled()               { return prefs.getBoolean(KEY_DMS_ENABLED, false); }
    public void    setDmsEnabled(boolean on)    { prefs.edit().putBoolean(KEY_DMS_ENABLED, on).apply(); }

    public int  getDmsIntervalMinutes()         { return prefs.getInt(KEY_DMS_INTERVAL, 15); }
    public void setDmsIntervalMinutes(int mins) { prefs.edit().putInt(KEY_DMS_INTERVAL, mins).apply(); }

    // ── Convoy ───────────────────────────────────────────────────────────────

    public String getConvoyCode()            { return prefs.getString(KEY_CONVOY_CODE, null); }
    public void   setConvoyCode(String code) {
        if (code == null) prefs.edit().remove(KEY_CONVOY_CODE).apply();
        else prefs.edit().putString(KEY_CONVOY_CODE, code).apply();
    }

    // ── Unread messages ──────────────────────────────────────────────────────

    public int  getUnreadMessages()      { return prefs.getInt(KEY_UNREAD_MSGS, 0); }
    public void setUnreadMessages(int n) { prefs.edit().putInt(KEY_UNREAD_MSGS, n).apply(); }
    public void incrementUnread()        { setUnreadMessages(getUnreadMessages() + 1); }
    public void clearUnread()            { setUnreadMessages(0); }
}
