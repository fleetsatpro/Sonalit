package com.sonalit.pegagent.util;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import timber.log.Timber;

public class SecureStore {

    private static final String PREFS_NAME = "peg_secure_prefs";
    private static SharedPreferences prefs;

    public static void init(Context ctx) {
        try {
            MasterKey masterKey = new MasterKey.Builder(ctx)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build();
            prefs = EncryptedSharedPreferences.create(
                    ctx,
                    PREFS_NAME,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
            Timber.d("SecureStore initialized");
        } catch (Throwable t) {
            // Catch Throwable (not just Exception) — Keystore can throw Error subclasses
            // (e.g. InternalError, VerifyError) on some devices/ROMs.
            Timber.e(t, "SecureStore init failed, falling back to plain prefs");
            try {
                prefs = ctx.getSharedPreferences(PREFS_NAME + "_plain", Context.MODE_PRIVATE);
            } catch (Throwable t2) {
                Timber.e(t2, "Plain prefs fallback also failed — SecureStore unavailable");
            }
        }
    }

    public static void put(String key, String value) {
        if (prefs == null) return;
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
