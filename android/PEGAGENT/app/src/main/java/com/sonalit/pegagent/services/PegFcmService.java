package com.sonalit.pegagent.services;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

import androidx.annotation.Nullable;

import timber.log.Timber;

/**
 * Stub FCM service — Firebase dependencies are disabled until google-services.json
 * is configured (add PEGAGENT_GOOGLE_SERVICES_JSON secret and re-enable firebase-messaging
 * in build.gradle). Commands arrive via WebSocket and HTTP polling in the meantime.
 */
public class PegFcmService extends Service {

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Timber.d("PegFcmService: Firebase not configured, ignoring");
        stopSelf();
        return START_NOT_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
