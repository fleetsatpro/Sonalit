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

        Timber.plant(new Timber.DebugTree());

        // SharedPreferences init — always succeeds, never throws
        SecureStore.init(this);

        createNotificationChannels();

        // Only start the command service if the device is already enrolled.
        // On first launch (no enrollment) we skip this entirely — starting a
        // foreground service with no enrollment data is pointless and risks an
        // ForegroundServiceDidNotStartInTimeException on some Android 14 builds.
        if (PegConfig.isEnrolled(this)) {
            startCommandService();
        } else {
            Timber.i("Not enrolled - skipping service start");
        }
    }

    public static PegAgentApp getInstance() {
        return instance;
    }

    public void startCommandService() {
        try {
            Intent svc = new Intent(this, PegCommandService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(svc);
            } else {
                startService(svc);
            }
        } catch (Throwable t) {
            Timber.e(t, "PegCommandService start failed");
        }
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;

        NotificationChannel core = new NotificationChannel(
                CHANNEL_CORE, "PEGAGENT Core", NotificationManager.IMPORTANCE_LOW);
        core.setDescription("Core agent status");
        core.setShowBadge(false);
        nm.createNotificationChannel(core);

        NotificationChannel sos = new NotificationChannel(
                CHANNEL_SOS, "SOS Alert", NotificationManager.IMPORTANCE_HIGH);
        sos.setDescription("Emergency SOS alerts");
        sos.enableVibration(true);
        sos.enableLights(true);
        nm.createNotificationChannel(sos);

        NotificationChannel cmd = new NotificationChannel(
                CHANNEL_COMMAND, "Commands", NotificationManager.IMPORTANCE_DEFAULT);
        cmd.setDescription("Remote command notifications");
        nm.createNotificationChannel(cmd);

        NotificationChannel session = new NotificationChannel(
                CHANNEL_SESSION, "Remote Session", NotificationManager.IMPORTANCE_LOW);
        session.setDescription("Knox remote session");
        nm.createNotificationChannel(session);
    }
}
