package com.sonalit.pegagent;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.os.Build;

import com.sonalit.pegagent.services.PegCommandService;
import com.sonalit.pegagent.util.PegConfig;
import com.sonalit.pegagent.util.SecureStore;

import timber.log.Timber;

public class PegAgentApp extends Application {

    public static final String CHANNEL_CORE    = "peg_core";
    public static final String CHANNEL_SOS     = "peg_sos";
    public static final String CHANNEL_COMMAND = "peg_command";
    public static final String CHANNEL_SESSION = "peg_session";

    private static PegAgentApp instance;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;

        // Init logging
        Timber.plant(new Timber.DebugTree());

        // Init secure storage
        SecureStore.init(this);

        // Create notification channels
        createNotificationChannels();

        // Start core command service
        try {
            Intent cmdService = new Intent(this, PegCommandService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(cmdService);
            } else {
                startService(cmdService);
            }
        } catch (Throwable t) {
            Timber.e(t, "Failed to start PegCommandService (non-fatal — UI will still show)");
        }

        Timber.i("PEGAGENT started. Device: %s | Org: %s",
                PegConfig.getDeviceId(this),
                PegConfig.getOrgId(this));
    }

    public static PegAgentApp getInstance() {
        return instance;
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager nm = getSystemService(NotificationManager.class);

        // Core persistent channel
        NotificationChannel core = new NotificationChannel(
                CHANNEL_CORE, "PEGAGENT Core", NotificationManager.IMPORTANCE_LOW);
        core.setDescription("Core agent status");
        core.setShowBadge(false);
        nm.createNotificationChannel(core);

        // SOS high priority
        NotificationChannel sos = new NotificationChannel(
                CHANNEL_SOS, "SOS Alert", NotificationManager.IMPORTANCE_HIGH);
        sos.setDescription("Emergency SOS alerts");
        sos.enableVibration(true);
        sos.enableLights(true);
        nm.createNotificationChannel(sos);

        // Command execution
        NotificationChannel cmd = new NotificationChannel(
                CHANNEL_COMMAND, "Commands", NotificationManager.IMPORTANCE_DEFAULT);
        cmd.setDescription("Remote command notifications");
        nm.createNotificationChannel(cmd);

        // Remote session
        NotificationChannel session = new NotificationChannel(
                CHANNEL_SESSION, "Remote Session", NotificationManager.IMPORTANCE_LOW);
        session.setDescription("Knox remote session");
        nm.createNotificationChannel(session);
    }
}
