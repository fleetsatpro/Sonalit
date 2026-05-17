package com.fleetops.guardian;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Receives the AlarmManager alarm for the dead-man's switch timeout.
 * Fires even if GuardianService has been killed by the OS — that is the
 * point of moving DMS off Handler.postDelayed onto AlarmManager.
 */
public class DmsAlarmReceiver extends BroadcastReceiver {
    private static final String TAG = "DmsAlarmReceiver";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        Log.w(TAG, "DMS alarm fired — triggering silent panic");

        // Ensure GuardianService is running so it can process the panic and ACK the server.
        Intent svc = new Intent(ctx, GuardianService.class);
        ctx.startService(svc);

        // Also send the PANIC broadcast — handled by GuardianService.controlReceiver
        // if the service is already alive, and by onStartCommand if it was just started.
        ctx.sendBroadcast(new Intent("com.fleetops.guardian.PANIC")
            .putExtra("mode", "silent")
            .putExtra("source", "dms_alarm"));
    }
}
