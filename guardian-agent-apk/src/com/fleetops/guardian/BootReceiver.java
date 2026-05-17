package com.fleetops.guardian;

import android.content.*;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            DevicePrefs prefs = new DevicePrefs(ctx);
            if (prefs.isEnrolled()) {
                ctx.startService(new Intent(ctx, GuardianService.class));
            }
        }
    }
}
