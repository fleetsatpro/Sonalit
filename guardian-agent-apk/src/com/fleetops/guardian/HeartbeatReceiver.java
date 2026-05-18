package com.fleetops.guardian;

import android.content.*;

public class HeartbeatReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!GuardianService.running) {
            Intent svc = new Intent(ctx, GuardianService.class);
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                ctx.startForegroundService(svc);
            } else {
                ctx.startService(svc);
            }
        }
    }
}
