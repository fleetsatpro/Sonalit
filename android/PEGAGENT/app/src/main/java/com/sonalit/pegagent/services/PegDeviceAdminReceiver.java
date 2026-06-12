package com.sonalit.pegagent.services;

import android.app.admin.DeviceAdminReceiver;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

import timber.log.Timber;

public class PegDeviceAdminReceiver extends DeviceAdminReceiver {

    public static ComponentName getComponentName(Context ctx) {
        return new ComponentName(ctx, PegDeviceAdminReceiver.class);
    }

    @Override
    public void onEnabled(Context ctx, Intent intent) {
        super.onEnabled(ctx, intent);
        Timber.i("Device admin ENABLED");
        // When device admin is enabled, allow screen capture for Knox sessions
        DevicePolicyManager dpm = ctx.getSystemService(DevicePolicyManager.class);
        ComponentName admin = getComponentName(ctx);
        try {
            dpm.setScreenCaptureDisabled(admin, false);
        } catch (SecurityException e) {
            Timber.w("setScreenCaptureDisabled requires Device Owner");
        }
    }

    @Override
    public void onDisabled(Context ctx, Intent intent) {
        super.onDisabled(ctx, intent);
        Timber.w("Device admin DISABLED");
    }

    @Override
    public void onProfileProvisioningComplete(Context ctx, Intent intent) {
        super.onProfileProvisioningComplete(ctx, intent);
        Timber.i("Profile provisioning complete - Device Owner enrolled");
        DevicePolicyManager dpm = ctx.getSystemService(DevicePolicyManager.class);
        ComponentName admin = getComponentName(ctx);
        try {
            // Allow Guardian APK to run without user confirmation
            dpm.setLockTaskPackages(admin, new String[]{ctx.getPackageName()});
            // Enable screen capture for Knox sessions
            dpm.setScreenCaptureDisabled(admin, false);
            Timber.i("Lock task and screen capture configured");
        } catch (Exception e) {
            Timber.e(e, "Device Owner configuration failed");
        }
    }

    @Override
    public void onLockTaskModeEntering(Context ctx, Intent intent, String pkg) {
        Timber.i("Lock task mode: %s", pkg);
    }

    public static boolean isDeviceOwner(Context ctx) {
        DevicePolicyManager dpm = ctx.getSystemService(DevicePolicyManager.class);
        return dpm.isDeviceOwnerApp(ctx.getPackageName());
    }

    public static boolean isAdminActive(Context ctx) {
        try {
            DevicePolicyManager dpm = ctx.getSystemService(DevicePolicyManager.class);
            return dpm != null && dpm.isAdminActive(getComponentName(ctx));
        } catch (Throwable t) {
            return false;
        }
    }
}
