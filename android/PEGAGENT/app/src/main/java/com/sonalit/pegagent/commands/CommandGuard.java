package com.sonalit.pegagent.commands;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.LinkedHashSet;
import java.util.Set;

import timber.log.Timber;

/**
 * CommandGuard — idempotency + TTL enforcement for {@link PegCommand}s (P1-3).
 *
 * A single command id can arrive over multiple delivery paths (WebSocket + the
 * 45s heartbeat poll) and be executed twice. This guard rejects any id it has
 * already accepted. The seen-id ring buffer is persisted to SharedPreferences so
 * it survives a process restart (a restart_app command must not re-fire on the
 * next poll).
 *
 * TTL: the server stamps {@code expires_at}; if absent we fall back to
 * {@code issued_at + ttl_hours}. Expired commands are rejected without executing.
 */
public final class CommandGuard {

    private static final String PREFS = "peg_cmd_guard";
    private static final String KEY_SEEN = "seen_ids";
    private static final int MAX_IDS = 256;
    private static final String SEP = ",";

    private final SharedPreferences prefs;
    private final Deque<String> ring = new ArrayDeque<>();
    private final Set<String> seen = new LinkedHashSet<>();

    public CommandGuard(Context ctx) {
        this.prefs = ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String stored = prefs.getString(KEY_SEEN, "");
        if (stored != null && !stored.isEmpty()) {
            for (String id : stored.split(SEP)) {
                if (!id.isEmpty() && seen.add(id)) ring.addLast(id);
            }
        }
    }

    /**
     * Atomic check-and-mark. Returns true if this call is the first to see the id
     * (caller owns execution); false if another delivery path already claimed it.
     * The check and the mark happen under a single lock so simultaneous WS + poll
     * deliveries of the same command cannot both win the race.
     */
    public synchronized boolean claim(String id) {
        if (id == null || id.isEmpty()) return false;
        if (!seen.add(id)) return false; // already claimed
        ring.addLast(id);
        while (ring.size() > MAX_IDS) {
            String evicted = ring.pollFirst();
            if (evicted != null) seen.remove(evicted);
        }
        persist();
        return true;
    }

    /**
     * Mark an id as processed without contesting a claim — used only for the
     * "expired" / "bad_signature" paths where we DO want the id burned so a
     * retry can't slip past, but we don't own execution.
     */
    public synchronized void markProcessed(String id) {
        claim(id);
    }

    private void persist() {
        prefs.edit().putString(KEY_SEEN, String.join(SEP, ring)).apply();
    }

    /**
     * @return true if the command has expired per {@code expires_at} (preferred)
     * or {@code issued_at + ttl_hours}. Unparseable timestamps are treated as
     * NOT expired (fail-open on parse) so a malformed stamp never silently drops
     * a safety command.
     */
    public boolean isExpired(PegCommand cmd) {
        long now = System.currentTimeMillis();

        Long expires = parseIso(cmd.expiresAt);
        if (expires != null) {
            return now > expires;
        }

        Long issued = parseIso(cmd.issuedAt);
        if (issued != null && cmd.ttlHours > 0) {
            long deadline = issued + cmd.ttlHours * 3600_000L;
            return now > deadline;
        }
        return false;
    }

    /** Parse ISO-8601 (with or without millis / trailing Z) to epoch millis, or null. */
    private static Long parseIso(String iso) {
        if (iso == null || iso.isEmpty()) return null;
        String s = iso.trim();
        // Normalise trailing Z to +0000 for SimpleDateFormat, strip fractional seconds.
        try {
            String normalized = s.replace("Z", "+0000");
            int dot = normalized.indexOf('.');
            if (dot >= 0) {
                // remove ".sss" fractional part but keep any timezone suffix
                int tzStart = normalized.length();
                for (int i = dot; i < normalized.length(); i++) {
                    char c = normalized.charAt(i);
                    if (c == '+' || c == '-') { tzStart = i; break; }
                }
                normalized = normalized.substring(0, dot) + normalized.substring(tzStart);
            }
            java.text.SimpleDateFormat fmt =
                    new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ", java.util.Locale.US);
            return fmt.parse(normalized).getTime();
        } catch (Exception e) {
            Timber.v("Unparseable timestamp: %s", iso);
            return null;
        }
    }
}
