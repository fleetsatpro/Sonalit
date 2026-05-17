package com.fleetops.guardian;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.os.Handler;
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
            } else if ("wipe_cache".equals(commandType)) {
                handleWipeCache(commandId);
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
        Vibrator v = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
        if (v != null) {
            long[] pattern = {0, 600, 200, 600, 200, 600, 200, 600};
            v.vibrate(pattern, -1);
        }
        try {
            final Ringtone r = RingtoneManager.getRingtone(ctx,
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM));
            if (r != null) {
                r.play();
                new Handler().postDelayed(new Runnable() {
                    @Override public void run() { r.stop(); }
                }, durationSec * 1000L);
            }
        } catch (Exception ignored) {}
        postNotification("REMOTE SIREN ACTIVATED",
            "Fleet manager triggered siren for " + durationSec + "s");
        listener.onHandled(id, true, "siren " + durationSec + "s");
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
        ctx.sendBroadcast(new Intent("com.fleetops.guardian.FORCE_HEARTBEAT"));
        listener.onHandled(id, true, "location requested");
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

    private void handleWipeCache(String id) {
        try {
            android.os.Process.killProcess(android.os.Process.myPid());
        } catch (Exception ignored) {}
        listener.onHandled(id, true, "cache wiped");
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
