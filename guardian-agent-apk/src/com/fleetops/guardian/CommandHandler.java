package com.fleetops.guardian;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.os.Handler;
import android.os.Looper;
import android.os.Vibrator;
import android.util.Log;
import org.json.JSONObject;

public class CommandHandler {
    private static final String TAG = "CommandHandler";

    public interface Listener {
        void onHandled(String commandId, boolean success, String result);
    }

    private final Context  ctx;
    private final Listener listener;

    // Class-level siren state so stop_siren can cancel it
    private Ringtone  activeSiren    = null;
    private Vibrator  activeVibrator = null;
    private final Handler  sirenHandler   = new Handler(Looper.getMainLooper());
    private Runnable  sirenStop      = null;

    public CommandHandler(Context ctx, Listener listener) {
        this.ctx = ctx;
        this.listener = listener;
    }

    public void handle(String commandId, String commandType, String payloadJson) {
        Log.i(TAG, "cmd=" + commandType + " id=" + commandId);
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
            } else {
                listener.onHandled(commandId, false, "unknown: " + commandType);
            }
        } catch (Exception e) {
            Log.e(TAG, "handle error", e);
            listener.onHandled(commandId, false, e.getMessage());
        }
    }

    private void stopActiveSiren() {
        if (sirenStop != null) {
            sirenHandler.removeCallbacks(sirenStop);
            sirenStop = null;
        }
        if (activeSiren != null) {
            try { activeSiren.stop(); } catch (Exception ignored) {}
            activeSiren = null;
        }
        if (activeVibrator != null) {
            try { activeVibrator.cancel(); } catch (Exception ignored) {}
            activeVibrator = null;
        }
    }

    private void handleSiren(final String id, JSONObject p) {
        final int durationSec = p.optInt("duration", 10);

        // Stop any already-running siren first
        stopActiveSiren();

        activeVibrator = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
        if (activeVibrator != null) {
            long[] pattern = {0, 600, 200, 600, 200, 600, 200, 600};
            activeVibrator.vibrate(pattern, 0); // repeat from index 0
        }
        try {
            activeSiren = RingtoneManager.getRingtone(ctx,
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM));
            if (activeSiren != null) {
                activeSiren.play();
            }
        } catch (Exception ignored) {}

        sirenStop = new Runnable() {
            @Override public void run() { stopActiveSiren(); }
        };
        sirenHandler.postDelayed(sirenStop, durationSec * 1000L);

        postNotification("REMOTE SIREN ACTIVATED",
            "Fleet manager triggered siren for " + durationSec + "s. Use Stop Siren to cancel.");
        listener.onHandled(id, true, "siren " + durationSec + "s");
    }

    private void handleStopSiren(String id) {
        stopActiveSiren();
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
