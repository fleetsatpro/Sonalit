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

import androidx.core.app.ActivityCompat;

import androidx.annotation.Nullable;
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

    private static final int NOTIF_ID     = 1001;
    private static final int POLL_DELAY   = (int) PegConfig.CMD_POLL_INTERVAL_MS;

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

        // Acquire partial wake lock - keeps CPU alive for WebSocket even when screen off
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "pegagent:command_service");
        wakeLock.acquire();

        // Init components
        api            = new PegApiClient(this);
        wsClient       = new PegWebSocketClient(this);
        commandExecutor = new CommandExecutor(this, api);
        telemetry       = new TelemetryEngine(this, api);

        wsClient.setCommandExecutor(commandExecutor);
        pollHandler = new Handler(Looper.getMainLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Android 14+ enforces that location permission is GRANTED before a foreground
        // service of type "location" can call startForeground(). Use dataSync as the
        // initial type and promote to location once the user grants permission.
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

        // Start WebSocket
        wsClient.connect();

        // Start telemetry heartbeat
        telemetry.start();

        // Start fallback polling in case WebSocket drops
        startFallbackPoll();

        Timber.i("PegCommandService started");
        return START_STICKY; // OS will restart if killed
    }

    /**
     * Fallback HTTP polling when WebSocket is down.
     * Runs every CMD_POLL_INTERVAL_MS (5s) but skips if WS is connected.
     */
    private void startFallbackPoll() {
        if (polling) return;
        polling = true;
        pollHandler.postDelayed(pollRunnable, POLL_DELAY);
    }

    private final Runnable pollRunnable = new Runnable() {
        @Override
        public void run() {
            if (!wsClient.isConnected()) {
                Timber.d("WS down, polling for commands");
                api.pollCommands(json -> {
                    try {
                        JsonArray cmds = gson.fromJson(json, JsonArray.class);
                        if (cmds != null) {
                            for (JsonElement el : cmds) {
                                PegCommand cmd = gson.fromJson(el, PegCommand.class);
                                commandExecutor.execute(cmd);
                            }
                        }
                    } catch (Exception e) {
                        Timber.e(e, "Poll parse error");
                    }
                });
            }
            pollHandler.postDelayed(this, POLL_DELAY);
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
        nm.notify(NOTIF_ID, buildNotification(status));
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        Timber.w("PegCommandService destroyed - will restart via START_STICKY");

        if (wsClient != null)       wsClient.disconnect();
        if (telemetry != null)      telemetry.stop();
        if (commandExecutor != null) commandExecutor.shutdown();
        if (api != null)            api.shutdown();
        if (pollHandler != null)    pollHandler.removeCallbacksAndMessages(null);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
