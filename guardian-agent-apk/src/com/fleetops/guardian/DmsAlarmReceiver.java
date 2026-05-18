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

        // Embed the DMS trigger in the service start intent so it is handled in
        // onStartCommand whether the service was already running or just started.
        // A separate sendBroadcast(PANIC) would be dropped if the service was dead
        // because the controlReceiver registers in onCreate(), which may not have
        // completed before the broadcast is dispatched.
        Intent svc = new Intent(ctx, GuardianService.class);
        svc.putExtra("dms_fired", true);
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            ctx.startForegroundService(svc);
        } else {
            ctx.startService(svc);
        }

        // Update the UI immediately — MainActivity listens for this action.
        ctx.sendBroadcast(new Intent("com.fleetops.guardian.DMS_FIRED"));
    }
}
