package com.sonalit.pegagent.services;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.sonalit.pegagent.util.PegConfig;

import timber.log.Timber;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            if (!PegConfig.isEnrolled(ctx)) {
                Timber.i("Boot complete — not enrolled, skipping service start");
                return;
            }
            Timber.i("Boot complete — starting PegCommandService");
            Intent svc = new Intent(ctx, PegCommandService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(svc);
            } else {
                ctx.startService(svc);
            }
        }
    }
}
