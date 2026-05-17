package com.fleetops.guardian;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import android.util.Log;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

public class DevicePrefs {
    private static final String TAG   = "DevicePrefs";
    private static final String PREFS = "guardian_prefs";

    private static final String KEY_TOKEN          = "device_token";
    private static final String KEY_TOKEN_ENC      = "device_token_enc";
    private static final String KEY_SERVER         = "server_url";
    private static final String KEY_NAME           = "device_name";
    private static final String KEY_ENROLLED       = "enrolled";
    private static final String KEY_PANIC_PIN      = "panic_pin";
    private static final String KEY_DMS_ENABLED    = "dms_enabled";
    private static final String KEY_DMS_INTERVAL   = "dms_interval_min";
    private static final String KEY_CONVOY_CODE    = "convoy_code";
    private static final String KEY_UNREAD_MSGS    = "unread_messages";

    private static final String KEY_ALIAS = "guardian_device_key";
    private static final String ENC_PREFIX = "ENC:";

    private final SharedPreferences prefs;

    public DevicePrefs(Context ctx) {
        prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ── KeyStore helpers ─────────────────────────────────────────────────────

    private SecretKey getOrCreateSecretKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null);
            return entry.getSecretKey();
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build();
        kg.init(spec);
        kg.generateKey();
        KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null);
        return entry.getSecretKey();
    }

    private String encryptToken(String plaintext) throws Exception {
        SecretKey key = getOrCreateSecretKey();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] iv = cipher.getIV();
        byte[] ciphertext = cipher.doFinal(plaintext.getBytes("UTF-8"));
        // Combine iv + ciphertext
        byte[] combined = new byte[iv.length + ciphertext.length];
        System.arraycopy(iv, 0, combined, 0, iv.length);
        System.arraycopy(ciphertext, 0, combined, iv.length, ciphertext.length);
        return Base64.encodeToString(combined, Base64.NO_WRAP);
    }

    private String decryptToken(String encrypted) throws Exception {
        byte[] combined = Base64.decode(encrypted, Base64.NO_WRAP);
        // GCM IV is 12 bytes
        byte[] iv = new byte[12];
        byte[] ciphertext = new byte[combined.length - 12];
        System.arraycopy(combined, 0, iv, 0, 12);
        System.arraycopy(combined, 12, ciphertext, 0, ciphertext.length);
        SecretKey key = getOrCreateSecretKey();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
        byte[] plaintext = cipher.doFinal(ciphertext);
        return new String(plaintext, "UTF-8");
    }

    // ── Enrollment ───────────────────────────────────────────────────────────

    public boolean isEnrolled() {
        return prefs.getBoolean(KEY_ENROLLED, false);
    }

    public void saveEnrollment(String serverUrl, String token, String deviceName) {
        SharedPreferences.Editor editor = prefs.edit();
        editor.putString(KEY_SERVER, serverUrl);
        editor.putString(KEY_NAME, deviceName);
        editor.putBoolean(KEY_ENROLLED, true);
        // Save token encrypted
        saveToken(token, editor);
        editor.apply();
    }

    public void clearEnrollment() {
        prefs.edit().clear().apply();
    }

    /**
     * Save token using KeyStore encryption if available, fallback to plaintext.
     * Uses a provided editor so it can be batched with other writes.
     */
    private void saveToken(String token, SharedPreferences.Editor editor) {
        try {
            String encrypted = encryptToken(token);
            editor.putString(KEY_TOKEN_ENC, ENC_PREFIX + encrypted);
            editor.remove(KEY_TOKEN); // remove old plaintext if present
        } catch (Exception e) {
            Log.w(TAG, "KeyStore encrypt failed, falling back to plaintext: " + e.getMessage());
            editor.putString(KEY_TOKEN, token);
        }
    }

    /**
     * Save token (standalone — used when updating token outside enrollment).
     */
    public void saveToken(String token) {
        SharedPreferences.Editor editor = prefs.edit();
        saveToken(token, editor);
        editor.apply();
    }

    public String getToken() {
        // Try encrypted key first
        String enc = prefs.getString(KEY_TOKEN_ENC, null);
        if (enc != null && enc.startsWith(ENC_PREFIX)) {
            try {
                return decryptToken(enc.substring(ENC_PREFIX.length()));
            } catch (Exception e) {
                Log.w(TAG, "KeyStore decrypt failed, falling back to plaintext: " + e.getMessage());
            }
        }
        // Fallback to plaintext (old installs)
        return prefs.getString(KEY_TOKEN, "");
    }

    public String getServerUrl()  { return prefs.getString(KEY_SERVER, ""); }
    public String getDeviceName() { return prefs.getString(KEY_NAME, "Guardian Device"); }

    // ── Panic PIN (PBKDF2WithHmacSHA256, 120k iterations, 32-byte output) ───────
    // Note: Argon2id requires API 33+ or external JAR; PBKDF2 is used instead.

    private static final String KEY_PANIC_PIN_HASH = "panic_pin_hash";
    private static final int    PBKDF2_ITERATIONS  = 120_000;
    private static final int    PBKDF2_KEY_LEN     = 32;

    /** Call once at startup to migrate any stored plaintext PIN to hashed form. */
    public void migratePanicPin() {
        String legacy = prefs.getString(KEY_PANIC_PIN, null);
        if (legacy != null && !legacy.isEmpty()
                && prefs.getString(KEY_PANIC_PIN_HASH, null) == null) {
            setPanicPin(legacy);
            prefs.edit().remove(KEY_PANIC_PIN).apply();
            Log.i(TAG, "Panic PIN migrated to hashed storage");
        }
    }

    private byte[] pbkdf2(String pin, byte[] salt) throws Exception {
        javax.crypto.spec.PBEKeySpec spec = new javax.crypto.spec.PBEKeySpec(
            pin.toCharArray(), salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LEN * 8);
        javax.crypto.SecretKeyFactory skf =
            javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        return skf.generateSecret(spec).getEncoded();
    }

    private boolean constantTimeEqual(byte[] a, byte[] b) {
        if (a.length != b.length) return false;
        int diff = 0;
        for (int i = 0; i < a.length; i++) diff |= (a[i] ^ b[i]);
        return diff == 0;
    }

    public void setPanicPin(String pin) {
        if (pin == null || pin.isEmpty()) {
            prefs.edit().remove(KEY_PANIC_PIN_HASH).remove(KEY_PANIC_PIN).apply();
            return;
        }
        try {
            byte[] salt = new byte[16];
            new java.security.SecureRandom().nextBytes(salt);
            byte[] hash = pbkdf2(pin, salt);
            String stored = "PBKDF2:"
                + Base64.encodeToString(salt, Base64.NO_WRAP) + ":"
                + Base64.encodeToString(hash, Base64.NO_WRAP);
            prefs.edit()
                .putString(KEY_PANIC_PIN_HASH, stored)
                .remove(KEY_PANIC_PIN)
                .apply();
        } catch (Exception e) {
            Log.e(TAG, "setPanicPin hash failed; storing plaintext as fallback", e);
            prefs.edit().putString(KEY_PANIC_PIN, pin).apply();
        }
    }

    public boolean hasPanicPin() {
        return prefs.getString(KEY_PANIC_PIN_HASH, null) != null
            || !prefs.getString(KEY_PANIC_PIN, "").isEmpty();
    }

    public boolean verifyPanicPin(String entered) {
        if (entered == null || entered.isEmpty()) return false;
        try {
            String stored = prefs.getString(KEY_PANIC_PIN_HASH, null);
            if (stored != null && stored.startsWith("PBKDF2:")) {
                String[] parts = stored.split(":");
                if (parts.length != 3) return false;
                byte[] salt     = Base64.decode(parts[1], Base64.NO_WRAP);
                byte[] expected = Base64.decode(parts[2], Base64.NO_WRAP);
                byte[] computed = pbkdf2(entered, salt);
                return constantTimeEqual(computed, expected);
            }
            // Legacy plaintext fallback (migrated next startup via migratePanicPin)
            String legacy = prefs.getString(KEY_PANIC_PIN, "");
            return !legacy.isEmpty() && legacy.equals(entered);
        } catch (Exception e) {
            Log.e(TAG, "verifyPanicPin error", e);
            return false;
        }
    }

    /** @deprecated Use verifyPanicPin() / hasPanicPin() instead. */
    @Deprecated
    public String getPanicPin() { return prefs.getString(KEY_PANIC_PIN, ""); }

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

    // ── Certificate pinning ──────────────────────────────────────────────────

    public String getCertPinSha256()           { return prefs.getString("cert_pin_sha256", null); }
    public void   setCertPinSha256(String pin) { prefs.edit().putString("cert_pin_sha256", pin).apply(); }

    // ── Command signing ──────────────────────────────────────────────────────

    public String getCommandSigningSecret()           { return prefs.getString("command_signing_secret", null); }
    public void   setCommandSigningSecret(String key) { prefs.edit().putString("command_signing_secret", key).apply(); }

    // ── DMS user-customized flag ─────────────────────────────────────────────

    public boolean isDmsIntervalCustomized()           { return prefs.getBoolean("dms_interval_customized", false); }
    public void    setDmsIntervalCustomized(boolean v) { prefs.edit().putBoolean("dms_interval_customized", v).apply(); }

    // ── FCM push token ───────────────────────────────────────────────────────

    public String getFcmToken()              { return prefs.getString("fcm_token", null); }
    public void   setFcmToken(String token)  { prefs.edit().putString("fcm_token", token).apply(); }
}
