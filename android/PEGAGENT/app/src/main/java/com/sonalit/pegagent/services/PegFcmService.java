package com.sonalit.pegagent.services;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

import androidx.annotation.Nullable;

import timber.log.Timber;

/**
 * FCM stub — Firebase is disabled until google-services.json is configured.
 * Replace this with FirebaseMessagingService when Firebase is re-enabled.
 */
public class PegFcmService extends Service {

    @Override
    public void onCreate() {
        super.onCreate();
        Timber.d("PegFcmService stub created (Firebase disabled)");
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
