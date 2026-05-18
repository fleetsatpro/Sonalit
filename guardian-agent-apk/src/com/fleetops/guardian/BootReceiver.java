package com.fleetops.guardian;

import android.content.*;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            DevicePrefs prefs = new DevicePrefs(ctx);
            if (prefs.isEnrolled()) {
                Intent svc = new Intent(ctx, GuardianService.class);
                if (android.os.Build.VERSION.SDK_INT >= 26) {
                    ctx.startForegroundService(svc);
                } else {
                    ctx.startService(svc);
                }
            }
        }
    }
}
