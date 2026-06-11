package com.sonalit.pegagent.services;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.sonalit.pegagent.PegAgentApp;
import com.sonalit.pegagent.R;
import com.sonalit.pegagent.commands.CommandExecutor;
import com.sonalit.pegagent.commands.PegCommand;
import com.sonalit.pegagent.network.PegApiClient;
import com.sonalit.pegagent.network.PegWebSocketClient;
import com.sonalit.pegagent.telemetry.TelemetryEngine;
import com.sonalit.pegagent.ui.MainActivity;
import com.sonalit.pegagent.util.PegConfig;

import timber.log.Timber;

/**
 * PegCommandService: the persistent core of PEGAGENT.
 * Runs as a foreground service from app start until device shutdown.
 * Owns: WebSocket connection, CommandExecutor, TelemetryEngine, fallback polling.
 * Restart behavior: START_STICKY ensures the OS restarts this service if killed.
 */
public class PegCommandService extends Service {

    private static final int NOTIF_ID   = 1001;
    private static final int POLL_DELAY = (int) PegConfig.CMD_POLL_INTERVAL_MS;

    private PegApiClient api;
    private PegWebSocketClient wsClient;
    private CommandExecutor commandExecutor;
    private TelemetryEngine telemetry;
    private PowerManager.WakeLock wakeLock;
    private Handler pollHandler;
    private boolean polling = false;
    private final Gson gson = new Gson();

    @Override
    public void onCreate() {
        super.onCreate();
        Timber.i("PegCommandService created");

        // WakeLock — 30 min timeout prevents indefinite hold on OEM battery restrictions
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "pegagent:command_service");
                wakeLock.acquire(30 * 60 * 1000L);
            }
        } catch (Throwable t) {
            Timber.e(t, "WakeLock init failed (non-fatal)");
        }

        // Init networking and command components. Wrapped so that any failure (e.g.
        // missing Play Services, Keystore error) does NOT prevent startForeground()
        // from being called in onStartCommand() — an uncaught exception here would
        // cause ForegroundServiceDidNotStartInTimeException and crash the app.
        try {
            api             = new PegApiClient(this);
            wsClient        = new PegWebSocketClient(this);
            commandExecutor = new CommandExecutor(this, api);
            telemetry       = new TelemetryEngine(this, api);
            wsClient.setCommandExecutor(commandExecutor);
        } catch (Throwable t) {
            Timber.e(t, "Component init failed — service will run in degraded mode");
        }

        pollHandler = new Handler(Looper.getMainLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // startForeground() MUST be called before any other work — Android 8+ kills the
        // process if this isn't done within 5 seconds of startForegroundService().
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
            Timber.e(t, "startForeground failed — attempting fallback");
            try {
                startForeground(NOTIF_ID, buildNotification("Agent starting..."));
            } catch (Throwable t2) {
                Timber.e(t2, "startForeground fallback also failed");
            }
        }

        if (wsClient != null) wsClient.connect();
        if (telemetry != null) telemetry.start();
        if (pollHandler != null) startFallbackPoll();

        Timber.i("PegCommandService started");
        return START_STICKY;
    }

    private void startFallbackPoll() {
        if (polling) return;
        polling = true;
        pollHandler.postDelayed(pollRunnable, POLL_DELAY);
    }

    private final Runnable pollRunnable = new Runnable() {
        @Override
        public void run() {
            if (wsClient != null && api != null && !wsClient.isConnected()) {
                Timber.d("WS down, polling for commands");
                api.pollCommands(json -> {
                    try {
                        JsonArray cmds = gson.fromJson(json, JsonArray.class);
                        if (cmds != null) {
                            for (JsonElement el : cmds) {
                                PegCommand cmd = gson.fromJson(el, PegCommand.class);
                                if (commandExecutor != null) commandExecutor.execute(cmd);
                            }
                        }
                    } catch (Exception e) {
                        Timber.e(e, "Poll parse error");
                    }
                });
            }
            if (pollHandler != null) pollHandler.postDelayed(this, POLL_DELAY);
        }
    };

    private Notification buildNotification(String status) {
        PendingIntent pi = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE);

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
        Timber.w("PegCommandService destroyed - will restart via START_STICKY");

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
