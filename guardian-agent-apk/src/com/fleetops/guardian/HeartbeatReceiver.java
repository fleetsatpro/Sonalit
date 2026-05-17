package com.fleetops.guardian;

import android.content.*;

public class HeartbeatReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!GuardianService.running) {
            ctx.startService(new Intent(ctx, GuardianService.class));
        }
    }
}
