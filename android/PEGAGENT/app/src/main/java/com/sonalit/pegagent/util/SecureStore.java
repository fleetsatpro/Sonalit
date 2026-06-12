package com.sonalit.pegagent.util;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Simple SharedPreferences wrapper.
 * Previously used EncryptedSharedPreferences (security-crypto:1.1.0-alpha06), but that
 * alpha library throws non-Exception Throwables (InternalError, VerifyError) from the
 * Android Keystore on many devices, crashing the app before the UI ever appears.
 * Plain SharedPreferences is reliable on every Android version we support (API 26+).
 */
public class SecureStore {

    private static final String PREFS_NAME = "peg_prefs";
    private static SharedPreferences prefs;

    public static void init(Context ctx) {
        prefs = ctx.getApplicationContext()
                   .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public static void put(String key, String value) {
        if (prefs == null || value == null) return;
        prefs.edit().putString(key, value).apply();
    }

    public static String get(String key) {
        if (prefs == null) return null;
        return prefs.getString(key, null);
    }

    public static void remove(String key) {
        if (prefs == null) return;
        prefs.edit().remove(key).apply();
    }

    public static void clearAll() {
        if (prefs == null) return;
        prefs.edit().clear().apply();
    }
}
