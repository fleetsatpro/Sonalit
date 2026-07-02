package com.sonalit.pegagent.util;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import timber.log.Timber;

/**
 * SecureStore — credential store backed by {@link EncryptedSharedPreferences}
 * (AndroidX Security + a Keystore master key) with a hard plaintext fallback (P2-1).
 *
 * History: an earlier build shipped EncryptedSharedPreferences as the ONLY store;
 * on some Samsung One UI devices the Keystore/Tink path throws non-Exception
 * Throwables (InternalError/VerifyError) before the UI appears, crashing the app.
 * Here every Keystore interaction is wrapped: on ANY Throwable we fall back to the
 * plaintext {@code peg_prefs} store (the previous reliable behaviour). Net result:
 * real encryption where the Keystore is healthy, no launch crash where it is not.
 *
 * On successful encryption init we migrate any legacy plaintext values into the
 * encrypted store and wipe the plaintext copy.
 */
public class SecureStore {

    private static final String PLAINTEXT_PREFS = "peg_prefs";
    private static final String ENCRYPTED_PREFS = "peg_prefs_enc";

    private static SharedPreferences prefs;      // active store (encrypted or plaintext)
    private static boolean encrypted = false;

    public static void init(Context ctx) {
        Context app = ctx.getApplicationContext();
        SharedPreferences plaintext =
                app.getSharedPreferences(PLAINTEXT_PREFS, Context.MODE_PRIVATE);
        try {
            MasterKey masterKey = new MasterKey.Builder(app)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build();
            SharedPreferences enc = EncryptedSharedPreferences.create(
                    app, ENCRYPTED_PREFS, masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
            prefs = enc;
            encrypted = true;
            migratePlaintext(plaintext, enc);
            Timber.i("SecureStore: encrypted store active");
        } catch (Throwable t) {
            // Keystore/Tink failure — never crash; use plaintext as before.
            prefs = plaintext;
            encrypted = false;
            Timber.w(t, "SecureStore: encryption unavailable — using plaintext fallback");
        }
    }

    private static void migratePlaintext(SharedPreferences plaintext, SharedPreferences enc) {
        try {
            java.util.Map<String, ?> all = plaintext.getAll();
            if (all.isEmpty()) return;
            SharedPreferences.Editor e = enc.edit();
            for (java.util.Map.Entry<String, ?> entry : all.entrySet()) {
                Object v = entry.getValue();
                if (v instanceof String) e.putString(entry.getKey(), (String) v);
            }
            e.apply();
            plaintext.edit().clear().apply(); // delete plaintext copy after migration
            Timber.i("SecureStore: migrated %d legacy values to encrypted store", all.size());
        } catch (Throwable t) {
            Timber.w(t, "SecureStore: plaintext migration skipped");
        }
    }

    public static boolean isEncrypted() {
        return encrypted;
    }

    public static void put(String key, String value) {
        if (prefs == null || value == null) return;
        try { prefs.edit().putString(key, value).apply(); }
        catch (Throwable t) { Timber.w(t, "SecureStore.put failed"); }
    }

    public static String get(String key) {
        if (prefs == null) return null;
        try { return prefs.getString(key, null); }
        catch (Throwable t) { Timber.w(t, "SecureStore.get failed"); return null; }
    }

    public static void remove(String key) {
        if (prefs == null) return;
        try { prefs.edit().remove(key).apply(); } catch (Throwable ignored) {}
    }

    public static void clearAll() {
        if (prefs == null) return;
        try { prefs.edit().clear().apply(); } catch (Throwable ignored) {}
    }
}
