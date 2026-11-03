package com.fleetops.guardian;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class GuardianAdminReceiver extends DeviceAdminReceiver {
    private static final String TAG = "GuardianAdmin";

    @Override
    public void onEnabled(Context ctx, Intent intent) {
        Log.i(TAG, "Device admin enabled");
    }

    @Override
    public CharSequence onDisableRequested(Context ctx, Intent intent) {
        // Alert the backend silently when admin is about to be deactivated
        final DevicePrefs prefs = new DevicePrefs(ctx);
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    org.json.JSONObject body = new org.json.JSONObject();
                    body.put("mode", "security");
                    double lat = GuardianService.lastLat;
                    double lng = GuardianService.lastLng;
                    if (lat != 0.0 || lng != 0.0) {
                        body.put("lat", lat);
                        body.put("lng", lng);
                    }
                    ApiClient.post(
                        prefs.getServerUrl() + "/api/v1/guardian/panic",
                        prefs.getToken(),
                        body.toString());
                } catch (Exception e) {
                    Log.e(TAG, "alert on disable error", e);
                }
            }
        }).start();
        return "WARNING: Deactivating Fleet Guardian admin will trigger a security alert " +
            "to your fleet manager and may be logged as a policy violation.";
    }

    @Override
    public void onDisabled(Context ctx, Intent intent) {
        Log.w(TAG, "Device admin disabled by user");
    }
}
