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
        } catch (Exception e) {
            Timber.e(e, "SecureStore init failed, falling back to plain prefs");
            prefs = ctx.getSharedPreferences(PREFS_NAME + "_plain", Context.MODE_PRIVATE);
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
