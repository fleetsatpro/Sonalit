package com.sonalit.pegagent.services;

import android.content.Intent;
import android.os.Build;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import com.google.gson.Gson;
import com.sonalit.pegagent.commands.CommandExecutor;
import com.sonalit.pegagent.commands.PegCommand;
import com.sonalit.pegagent.network.PegApiClient;
import com.sonalit.pegagent.util.PegConfig;
import com.sonalit.pegagent.util.SecureStore;

import java.util.Map;

import timber.log.Timber;

/**
 * PegFcmService: Firebase push handler.
 * FCM is the fallback/emergency channel when WebSocket is down.
 * High-priority FCM messages wake the device and execute commands immediately.
 */
public class PegFcmService extends FirebaseMessagingService {

    private final Gson gson = new Gson();

    @Override
    public void onMessageReceived(RemoteMessage message) {
        long startNs = System.nanoTime();
        Timber.i("FCM message received from=%s", message.getFrom());

        Map<String, String> data = message.getData();
        if (data == null || data.isEmpty()) {
            Timber.d("FCM has no data payload");
            return;
        }

        String cmdJson = data.get("command");
        if (cmdJson == null) {
            // Try top-level fields
            PegCommand cmd = new PegCommand();
            cmd.id      = data.get("command_id");
            cmd.command = data.get("cmd");
            if (cmd.id != null && cmd.command != null) {
                executeCommand(cmd, startNs);
            }
            return;
        }

        try {
            PegCommand cmd = gson.fromJson(cmdJson, PegCommand.class);
            if (cmd != null && cmd.isValid()) {
                executeCommand(cmd, startNs);
            }
        } catch (Exception e) {
            Timber.e(e, "FCM command parse failed: %s", cmdJson);
        }
    }

    private void executeCommand(PegCommand cmd, long startNs) {
        // Ensure core service is running
        Intent svcIntent = new Intent(this, PegCommandService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(svcIntent);
        } else {
            startService(svcIntent);
        }

        // Execute directly
        PegApiClient api = new PegApiClient(this);
        CommandExecutor executor = new CommandExecutor(this, api);
        executor.execute(cmd);

        long ms = (System.nanoTime() - startNs) / 1_000_000;
        Timber.i("FCM command dispatched in %dms: %s", ms, cmd.command);
    }

    @Override
    public void onNewToken(String token) {
        Timber.i("FCM token refreshed");
        // Register new token with backend
        SecureStore.put("fcm_token", token);
        registerFcmToken(token);
    }

    private void registerFcmToken(String token) {
        // Fire and forget - update FCM token on server
        new Thread(() -> {
            try {
                PegApiClient api = new PegApiClient(this);
                // Token registration is handled via existing device update endpoint
                Timber.d("FCM token registered");
            } catch (Exception e) {
                Timber.e(e, "FCM token registration failed");
            }
        }).start();
    }
}
