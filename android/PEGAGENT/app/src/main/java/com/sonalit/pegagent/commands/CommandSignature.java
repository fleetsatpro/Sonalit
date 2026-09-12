package com.sonalit.pegagent.commands;

import android.content.Context;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;

import com.sonalit.pegagent.util.PegConfig;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import timber.log.Timber;

/**
 * CommandSignature — verifies the server's per-command HMAC (P2-7).
 *
 * Server scheme (backend guardian.js {@code signCommand}):
 * <pre>
 *   payloadHash = sha256_hex( canonicalJson(payload) )     // null payload → "{}"
 *   message     = commandId ":" commandType ":" payloadHash ":" issuedAt ":" expiresAt
 *   signature   = HMAC_SHA256_hex( COMMAND_SIGNING_SECRET, message )
 * </pre>
 * canonicalJson = sorted object keys, no whitespace, JSON.stringify string/number
 * semantics. We canonicalize the raw received payload element (not the POJO) so
 * fidelity matches the wire form.
 *
 * The signing secret is delivered in the enroll + heartbeat responses and stored
 * via {@link PegConfig#getCommandSigningSecret(Context)}.
 */
public final class CommandSignature {

    private static final Gson GSON = new Gson();

    private CommandSignature() {}

    /** Destructive/high-impact commands require a valid signature before executing. */
    public static boolean isDestructive(PegCommand cmd) {
        if (cmd == null || cmd.command == null) return false;
        switch (cmd.command) {
            case PegCommand.CMD_REMOTE_WIPE:
            case PegCommand.CMD_LOCK_SCREEN:
                return true;
            case PegCommand.CMD_CLEAR_DATA:
                return cmd.payload != null && cmd.payload.full;
            default:
                return false;
        }
    }

    /**
     * Verify {@code cmd.signature} against the signing secret.
     *
     * @param rawPayload the payload exactly as received on the wire (may be null),
     *                   used for byte-faithful canonicalization.
     * @return true if the signature matches; false on mismatch, missing secret,
     *         or missing signature.
     */
    public static boolean verify(Context ctx, PegCommand cmd, JsonElement rawPayload) {
        if (cmd == null || cmd.signature == null || cmd.signature.isEmpty()) {
            Timber.w("Command %s has no signature", cmd != null ? cmd.id : "?");
            return false;
        }
        String secret = PegConfig.getCommandSigningSecret(ctx);
        if (secret == null || secret.isEmpty()) {
            Timber.w("No command signing secret stored — cannot verify");
            return false;
        }
        try {
            String payloadHash = sha256Hex(canonicalJson(rawPayload));
            String issued  = cmd.issuedAt  != null ? cmd.issuedAt  : "";
            String expires = cmd.expiresAt != null ? cmd.expiresAt : "";
            String message = cmd.id + ":" + cmd.command + ":" + payloadHash + ":" + issued + ":" + expires;
            String expected = hmacSha256Hex(secret, message);
            boolean ok = constantTimeEquals(expected, cmd.signature);
            if (!ok) Timber.w("Signature mismatch for command %s (%s)", cmd.id, cmd.command);
            return ok;
        } catch (Exception e) {
            Timber.e(e, "Signature verification error");
            return false;
        }
    }

    /** Mirror of backend canonicalJson(): top-level null/undefined → "{}". */
    static String canonicalJson(JsonElement el) {
        if (el == null || el.isJsonNull()) return "{}";
        return sorted(el);
    }

    private static String sorted(JsonElement el) {
        if (el == null || el.isJsonNull()) return "null";
        if (el.isJsonPrimitive()) {
            JsonPrimitive p = el.getAsJsonPrimitive();
            if (p.isBoolean()) return String.valueOf(p.getAsBoolean());
            if (p.isNumber())  return p.getAsString(); // preserves original numeric token
            return GSON.toJson(p);                     // JSON.stringify semantics for strings
        }
        if (el.isJsonArray()) {
            StringBuilder sb = new StringBuilder("[");
            boolean first = true;
            for (JsonElement child : el.getAsJsonArray()) {
                if (!first) sb.append(',');
                sb.append(sorted(child));
                first = false;
            }
            return sb.append(']').toString();
        }
        // Object: sort keys, JSON.stringify each key.
        JsonObject obj = el.getAsJsonObject();
        List<String> keys = new ArrayList<>(obj.keySet());
        Collections.sort(keys);
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (String k : keys) {
            if (!first) sb.append(',');
            sb.append(GSON.toJson(new JsonPrimitive(k))).append(':').append(sorted(obj.get(k)));
            first = false;
        }
        return sb.append('}').toString();
    }

    private static String sha256Hex(String s) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        return hex(md.digest(s.getBytes(StandardCharsets.UTF_8)));
    }

    private static String hmacSha256Hex(String secret, String message) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return hex(mac.doFinal(message.getBytes(StandardCharsets.UTF_8)));
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(Character.forDigit((b >> 4) & 0xF, 16))
                               .append(Character.forDigit(b & 0xF, 16));
        return sb.toString();
    }

    private static boolean constantTimeEquals(String a, String b) {
        if (a == null || b == null || a.length() != b.length()) return false;
        int result = 0;
        for (int i = 0; i < a.length(); i++) result |= a.charAt(i) ^ b.charAt(i);
        return result == 0;
    }
}
