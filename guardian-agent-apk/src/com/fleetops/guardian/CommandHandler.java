package com.fleetops.guardian;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import org.json.JSONObject;

public class CommandHandler {
    private static final String TAG = "CommandHandler";

    public interface Listener {
        void onHandled(String commandId, boolean success, String result);
    }

    private final Context  ctx;
    private final Listener listener;

    public CommandHandler(Context ctx, Listener listener) {
        this.ctx = ctx;
        this.listener = listener;
    }

    public void handle(String commandId, String commandType, String payloadJson) {
        handle(commandId, commandType, payloadJson, null, null, null);
    }

    public void handle(String commandId, String commandType, String payloadJson,
                       String issuedAt, String signature) {
        handle(commandId, commandType, payloadJson, issuedAt, null, signature);
    }

    public void handle(String commandId, String commandType, String payloadJson,
                       String issuedAt, String expiresAt, String signature) {
        Log.i(TAG, "cmd=" + commandType + " id=" + commandId);

        // Mandatory HMAC verification (Task E: unconditional; Task B: new format includes payload + expiresAt)
        DevicePrefs prefs = new DevicePrefs(ctx);
        String signingKey = prefs.getCommandSigningSecret();
        if (signingKey == null || signingKey.isEmpty()) {
            Log.e(TAG, "No command signing key configured — rejecting cmd=" + commandId);
            listener.onHandled(commandId, false, "no_signing_key");
            return;
        }
        if (signature == null || signature.isEmpty()) {
            Log.e(TAG, "Command has no signature — rejecting cmd=" + commandId);
            listener.onHandled(commandId, false, "missing_signature");
            return;
        }
        // Format: commandId:commandType:sha256(canonicalJson(payload)):issuedAt:expiresAt
        String payloadHash = ApiClient.sha256Hex(ApiClient.canonicalJson(payloadJson));
        String message = commandId + ":" + commandType + ":" + payloadHash + ":"
                       + (issuedAt != null ? issuedAt : "") + ":"
                       + (expiresAt != null ? expiresAt : "");
        String expected = ApiClient.hmacSha256(message, signingKey);
        if (!signature.equals(expected)) {
            Log.e(TAG, "Command signature mismatch id=" + commandId + " — rejecting");
            listener.onHandled(commandId, false, "signature_mismatch");
            return;
        }

        try {
            JSONObject p = (payloadJson != null && !payloadJson.isEmpty())
                ? new JSONObject(payloadJson) : new JSONObject();

            if ("trigger_siren".equals(commandType)) {
                handleSiren(commandId, p);
            } else if ("stop_siren".equals(commandType)) {
                handleStopSiren(commandId);
            } else if ("lock_screen".equals(commandType)) {
                handleLockScreen(commandId, p);
            } else if ("push_message".equals(commandType)) {
                handleMessage(commandId, p);
            } else if ("request_location".equals(commandType)) {
                handleRequestLocation(commandId);
            } else if ("force_sync".equals(commandType)) {
                handleForceSync(commandId);
            } else if ("start_live_tracking".equals(commandType)) {
                handleLiveTracking(commandId, true);
            } else if ("stop_live_tracking".equals(commandType)) {
                handleLiveTracking(commandId, false);
            } else if ("enable_lost_mode".equals(commandType)) {
                handleLostMode(commandId, p);
            } else if ("restart_agent".equals(commandType)) {
                handleRestartAgent(commandId);
            } else {
                listener.onHandled(commandId, false, "unknown: " + commandType);
            }
        } catch (Exception e) {
            Log.e(TAG, "handle error", e);
            listener.onHandled(commandId, false, e.getMessage());
        }
    }

    private void handleSiren(final String id, JSONObject p) {
        final int durationSec = p.optInt("duration", 10);
        SirenController.getInstance(ctx).start(ctx, durationSec * 1000);
        postNotification("REMOTE SIREN ACTIVATED",
            "Fleet manager triggered siren for " + durationSec + "s. Use Stop Siren to cancel.");
        listener.onHandled(id, true, "siren " + durationSec + "s");
    }

    private void handleStopSiren(String id) {
        SirenController.getInstance(ctx).stop();
        postNotification("SIREN STOPPED", "Remote siren cancelled by fleet manager");
        listener.onHandled(id, true, "siren stopped");
    }

    private void handleLockScreen(String id, JSONObject p) {
        String msg = p.optString("message", "DEVICE LOCKED BY FLEET MANAGER");
        Intent i = new Intent(ctx, LockScreenActivity.class);
        i.putExtra("message", msg);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        ctx.startActivity(i);
        listener.onHandled(id, true, "lock shown");
    }

    private void handleMessage(String id, JSONObject p) {
        String title = p.optString("title", "Fleet Message");
        String text  = p.optString("text", p.optString("message", ""));
        // Store message locally so the Messages button can display history
        new DevicePrefs(ctx).addMessage(title, text);
        Intent b = new Intent("com.fleetops.guardian.MESSAGE");
        b.putExtra("title", title);
        b.putExtra("text", text);
        ctx.sendBroadcast(b);
        postNotification(title, text);
        listener.onHandled(id, true, "message delivered");
    }

    private void handleRequestLocation(String id) {
        // Broadcast to GuardianService to start a one-shot fresh GPS fix with a 15s timeout.
        // ACK is deferred — GuardianService calls ackCommand() directly after the fix or timeout.
        Intent req = new Intent("com.fleetops.guardian.REQUEST_FRESH_LOCATION");
        req.putExtra("command_id", id);
        ctx.sendBroadcast(req);
        // Do NOT call listener.onHandled() here — ack is handled asynchronously.
    }

    private void handleForceSync(String id) {
        ctx.sendBroadcast(new Intent("com.fleetops.guardian.FORCE_SYNC"));
        listener.onHandled(id, true, "sync triggered");
    }

    private void handleLiveTracking(String id, boolean fast) {
        Intent b = new Intent("com.fleetops.guardian.SET_TRACKING_RATE");
        b.putExtra("fast", fast);
        ctx.sendBroadcast(b);
        listener.onHandled(id, true, fast ? "live tracking on" : "live tracking off");
    }

    private void handleLostMode(String id, JSONObject p) {
        String msg = p.optString("message", "DEVICE REPORTED LOST — PLEASE RETURN TO FLEET MANAGER");
        Intent i = new Intent(ctx, LockScreenActivity.class);
        i.putExtra("message", msg);
        i.putExtra("lost_mode", true);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        ctx.startActivity(i);
        listener.onHandled(id, true, "lost mode active");
    }

    private void handleRestartAgent(String id) {
        listener.onHandled(id, true, "restarting");
        // Delay restart by 500 ms to let the ACK send before the service dies
        android.os.Handler h = new android.os.Handler(android.os.Looper.getMainLooper());
        h.postDelayed(new Runnable() {
            @Override public void run() {
                ctx.stopService(new Intent(ctx, GuardianService.class));
                ctx.startService(new Intent(ctx, GuardianService.class));
            }
        }, 500);
    }

    private void postNotification(String title, String text) {
        try {
            Notification.Builder b = new Notification.Builder(ctx)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle(title)
                .setContentText(text)
                .setAutoCancel(true);
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                try {
                    b.getClass().getMethod("setChannelId", String.class)
                        .invoke(b, "guardian_tracking");
                } catch (Exception ignored) {}
            }
            NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            nm.notify((int)(System.currentTimeMillis() % Integer.MAX_VALUE), b.build());
        } catch (Exception ignored) {}
    }
}
