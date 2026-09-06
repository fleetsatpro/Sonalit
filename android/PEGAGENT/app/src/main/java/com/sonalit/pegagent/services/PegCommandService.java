package com.sonalit.pegagent.services;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;

import com.sonalit.pegagent.PegAgentApp;
import com.sonalit.pegagent.commands.CommandExecutor;
import com.sonalit.pegagent.network.PegApiClient;
import com.sonalit.pegagent.network.PegWebSocketClient;
import com.sonalit.pegagent.telemetry.LocationEngine;
import com.sonalit.pegagent.telemetry.TelemetryEngine;
import com.sonalit.pegagent.ui.MainActivity;
import com.sonalit.pegagent.util.PegConfig;
import com.sonalit.pegagent.util.SirenController;

import timber.log.Timber;

public class PegCommandService extends Service {

    private static final int NOTIF_ID     = 1001;
    private static final int SOS_NOTIF_ID = 1002;
    private static final int POLL_DELAY   = (int) PegConfig.CMD_POLL_INTERVAL_MS;

    // WakeLock renewal (P2-2): re-acquire before the OS-imposed timeout expires.
    private static final long WAKELOCK_MS       = 20 * 60 * 1000L;
    private static final long WAKELOCK_RENEW_MS = 18 * 60 * 1000L;

    public static final String ACTION_SOS        = "com.sonalit.pegagent.ACTION_SOS";
    public static final String ACTION_SOS_CANCEL = "com.sonalit.pegagent.ACTION_SOS_CANCEL";
    public static final String ACTION_SOS_RESULT = "com.sonalit.pegagent.ACTION_SOS_RESULT";
    public static final String EXTRA_SOS_STATE   = "state"; // SENT | RETRY | FAILED | CANCELLED

    private static final int SOS_MAX_ATTEMPTS = 4;
    private static final long SOS_FIX_TIMEOUT_MS = 3_000L;

    private PegApiClient api;
    private PegWebSocketClient wsClient;
    private CommandExecutor commandExecutor;
    private TelemetryEngine telemetry;
    private PowerManager.WakeLock wakeLock;
    private Handler pollHandler;
    private boolean polling = false;

    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;

    // ── SOS receiver hosted in the always-on service (P0-1) ─────────────────────
    private final BroadcastReceiver sosReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            if (intent == null || intent.getAction() == null) return;
            String source = intent.getStringExtra("source");
            if (ACTION_SOS.equals(intent.getAction())) {
                handleSos(source != null ? source : "manual_button");
            } else if (ACTION_SOS_CANCEL.equals(intent.getAction())) {
                handleSosCancel();
            }
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        Timber.i("PegCommandService created");

        acquireWakeLock();

        try {
            api             = new PegApiClient(this);
            wsClient        = new PegWebSocketClient(this);
            commandExecutor = new CommandExecutor(this, api);
            telemetry       = new TelemetryEngine(this, api);
            wsClient.setCommandExecutor(commandExecutor);
            telemetry.setCommandExecutor(commandExecutor);
            PegAgentApp.setSharedWs(wsClient); // P2-4: single app-scoped Centrifugo client
        } catch (Throwable t) {
            Timber.e(t, "Component init failed — running in degraded mode");
        }

        pollHandler = new Handler(Looper.getMainLooper());

        registerSosReceiver();
        registerNetworkCallback();

        // One-time migration (P0-2): backfill org_id for pre-update enrolled devices.
        maybeBackfillOrgId();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                boolean hasLocation =
                        ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                                == PackageManager.PERMISSION_GRANTED
                        || ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION)
                                == PackageManager.PERMISSION_GRANTED;
                int fgsType = hasLocation
                        ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                        : ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
                startForeground(NOTIF_ID, buildNotification("Connected — monitoring active"), fgsType);
            } else {
                startForeground(NOTIF_ID, buildNotification("Connected — monitoring active"));
            }
        } catch (Throwable t) {
            Timber.e(t, "startForeground failed — fallback");
            try {
                startForeground(NOTIF_ID, buildNotification("Agent starting..."));
            } catch (Throwable t2) {
                Timber.e(t2, "startForeground fallback also failed");
            }
        }

        // Allow an external SOS trigger to arrive as a service start intent too.
        if (intent != null && ACTION_SOS.equals(intent.getAction())) {
            handleSos(intent.getStringExtra("source") != null
                    ? intent.getStringExtra("source") : "external");
        }

        if (wsClient != null) wsClient.connect();
        if (telemetry != null) telemetry.start();
        if (pollHandler != null) startFallbackPoll();

        Timber.i("PegCommandService started");
        return START_STICKY;
    }

    // ── SOS pipeline ────────────────────────────────────────────────────────────

    private void handleSos(String source) {
        Timber.w("SOS triggered source=%s", source);
        // Local alerting is immediate and does not depend on the network.
        SirenController.get().start(this, 30);
        showSosNotification("SOS ACTIVE — locating…");

        // Generate ONE event_uuid per SOS button press and reuse it across every
        // retry. The server dedupes on event_uuid so a lost 2xx response cannot
        // create a duplicate panic event for a single trigger.
        final String eventUuid = java.util.UUID.randomUUID().toString();

        LocationEngine.getInstance(this).getFreshLocation(SOS_FIX_TIMEOUT_MS, (loc, stale) -> {
            if (loc != null) {
                sendPanicWithRetry(eventUuid, loc.getLatitude(), loc.getLongitude(), stale, source, 1);
            } else {
                // No fix at all — still transmit with zeros + stale flag so dispatch is alerted.
                Timber.w("SOS with no location fix");
                sendPanicWithRetry(eventUuid, 0.0, 0.0, true, source, 1);
            }
        });
    }

    private void sendPanicWithRetry(String eventUuid, double lat, double lng, boolean stale,
                                    String source, int attempt) {
        if (api == null) { broadcastSosResult("FAILED"); return; }
        api.sendPanic(eventUuid, lat, lng, PegApiClient.PANIC_MODE_SOS, source, stale, (ok, code) -> {
            if (ok) {
                showSosNotification("SOS DELIVERED — help is being dispatched");
                broadcastSosResult("SENT");
            } else if (attempt < SOS_MAX_ATTEMPTS) {
                broadcastSosResult("RETRY");
                long backoff = 1_000L * (long) Math.pow(2, attempt); // 2s,4s,8s
                if (pollHandler != null) {
                    pollHandler.postDelayed(
                            () -> sendPanicWithRetry(eventUuid, lat, lng, stale, source, attempt + 1),
                            backoff);
                }
            } else {
                showSosNotification("SOS FAILED — retry from the app");
                broadcastSosResult("FAILED");
            }
        });
    }

    private void handleSosCancel() {
        Timber.w("SOS cancel requested");
        SirenController.get().stop();
        if (api != null) {
            api.sendPanicCancel((ok, code) -> broadcastSosResult(ok ? "CANCELLED" : "FAILED"));
        } else {
            broadcastSosResult("CANCELLED");
        }
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(SOS_NOTIF_ID);
    }

    private void broadcastSosResult(String state) {
        Intent i = new Intent(ACTION_SOS_RESULT).putExtra(EXTRA_SOS_STATE, state)
                .setPackage(getPackageName());
        sendBroadcast(i);
    }

    private void showSosNotification(String text) {
        PendingIntent pi = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification n = new NotificationCompat.Builder(this, PegAgentApp.CHANNEL_SOS)
                .setContentTitle("⚠ SOS EMERGENCY")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.stat_sys_warning)
                .setContentIntent(pi)
                .setFullScreenIntent(pi, true)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setOngoing(true)
                .build();

        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(SOS_NOTIF_ID, n);
    }

    // ── Registration helpers ─────────────────────────────────────────────────────

    private void registerSosReceiver() {
        IntentFilter f = new IntentFilter();
        f.addAction(ACTION_SOS);
        f.addAction(ACTION_SOS_CANCEL);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(sosReceiver, f, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(sosReceiver, f);
            }
        } catch (Throwable t) {
            Timber.e(t, "SOS receiver registration failed");
        }
    }

    private void registerNetworkCallback() {
        try {
            connectivityManager = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            if (connectivityManager == null) return;
            networkCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    Timber.d("Network available — kicking WS reconnect");
                    if (wsClient != null) wsClient.onNetworkAvailable();
                }
            };
            connectivityManager.registerDefaultNetworkCallback(networkCallback);
        } catch (Throwable t) {
            Timber.w(t, "Network callback registration failed");
        }
    }

    private void maybeBackfillOrgId() {
        if (!PegConfig.isEnrolled(this)) return;
        if (PegConfig.getOrgId(this) != null) return;
        if (api == null) return;
        api.fetchWhoami((orgId, officerId) -> {
            if (orgId != null) {
                PegConfig.saveOrgId(orgId);
                PegConfig.saveOfficerId(officerId);
                Timber.i("Backfilled org_id via whoami — resubscribing");
                if (wsClient != null) wsClient.resubscribe();
            }
        });
    }

    // ── WakeLock with renewal (P2-2) ─────────────────────────────────────────────

    private void acquireWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "pegagent:command_service");
                wakeLock.setReferenceCounted(false);
                if (!wakeLock.isHeld()) wakeLock.acquire(WAKELOCK_MS);
            }
        } catch (Throwable t) {
            Timber.e(t, "WakeLock init failed (non-fatal)");
        }
    }

    private final Runnable wakeLockRenew = new Runnable() {
        @Override
        public void run() {
            try {
                if (wakeLock != null) {
                    if (wakeLock.isHeld()) wakeLock.release();
                    wakeLock.acquire(WAKELOCK_MS);
                    Timber.d("WakeLock renewed");
                }
            } catch (Throwable t) {
                Timber.w(t, "WakeLock renew failed");
            }
            if (pollHandler != null) pollHandler.postDelayed(this, WAKELOCK_RENEW_MS);
        }
    };

    // ── Fallback poll ─────────────────────────────────────────────────────────────

    private void startFallbackPoll() {
        if (polling) return;
        polling = true;
        pollHandler.postDelayed(pollRunnable, POLL_DELAY);
        pollHandler.postDelayed(wakeLockRenew, WAKELOCK_RENEW_MS);
    }

    private final Runnable pollRunnable = new Runnable() {
        @Override
        public void run() {
            if (wsClient != null && api != null && !wsClient.isConnected()) {
                Timber.d("WS down, polling for commands");
                if (commandExecutor != null) {
                    api.pollCommands(commandExecutor::dispatchCommandsJson);
                }
            }
            if (pollHandler != null) pollHandler.postDelayed(this, POLL_DELAY);
        }
    };

    // ── Notification ──────────────────────────────────────────────────────────────

    private Notification buildNotification(String status) {
        PendingIntent pi = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        return new NotificationCompat.Builder(this, PegAgentApp.CHANNEL_CORE)
                .setContentTitle("PEGAGENT")
                .setContentText(status)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentIntent(pi)
                .setOngoing(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    public void updateNotification(String status) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_ID, buildNotification(status));
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        Timber.w("PegCommandService destroyed");
        try { unregisterReceiver(sosReceiver); } catch (Exception ignored) {}
        try {
            if (connectivityManager != null && networkCallback != null) {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            }
        } catch (Exception ignored) {}
        PegAgentApp.setSharedWs(null);
        if (wsClient != null)        wsClient.disconnect();
        if (telemetry != null)       telemetry.stop();
        if (commandExecutor != null) commandExecutor.shutdown();
        if (api != null)             api.shutdown();
        if (pollHandler != null)     pollHandler.removeCallbacksAndMessages(null);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
