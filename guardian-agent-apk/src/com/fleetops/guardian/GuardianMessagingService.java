package com.fleetops.guardian;

import android.content.Intent;
import android.util.Log;

/**
 * Firebase Cloud Messaging service.
 *
 * Handles data-only push messages from the backend. When the server issues a
 * remote command it sends a high-priority data-only FCM message so Android
 * calls onMessageReceived even while the app is in the background.
 *
 * We broadcast FORCE_HEARTBEAT so GuardianService immediately polls the
 * server for pending commands rather than waiting for the 30-second tick.
 *
 * Register in AndroidManifest.xml:
 *   <service android:name=".GuardianMessagingService" android:exported="false">
 *     <intent-filter>
 *       <action android:name="com.google.firebase.MESSAGING_EVENT" />
 *     </intent-filter>
 *   </service>
 */
public class GuardianMessagingService extends com.google.firebase.messaging.FirebaseMessagingService {

    private static final String TAG = "GuardianFCM";

    @Override
    public void onMessageReceived(com.google.firebase.messaging.RemoteMessage msg) {
        String type = msg.getData().get("type");
        Log.d(TAG, "FCM message received: type=" + type);

        if ("command".equals(type) || "panic_ack".equals(type)) {
            // Wake GuardianService and trigger an immediate heartbeat so the
            // pending command is fetched and executed without waiting 30 s.
            sendBroadcast(new Intent("com.fleetops.guardian.FORCE_HEARTBEAT"));
        }
    }

    @Override
    public void onNewToken(String token) {
        Log.i(TAG, "FCM token refreshed — will be sent on next heartbeat");
        // Store the new token; it will be included in the next heartbeat payload.
        new DevicePrefs(this).setFcmToken(token);
    }
}
