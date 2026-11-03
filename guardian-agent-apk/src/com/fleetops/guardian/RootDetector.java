package com.fleetops.guardian;

import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;
import java.io.File;

/**
 * Task 5.4 — Tamper and root detection.
 *
 * Performs lightweight heuristic checks without Play Integrity API
 * (unavailable without GMS). Results are advisory — GuardianService
 * includes them in heartbeat metadata so the fleet manager can decide
 * whether to restrict a compromised device.
 *
 * Checks performed:
 *  1. Common root binary locations (su, busybox, magisk)
 *  2. Test-keys build tag (non-release firmware)
 *  3. Presence of known root management apps (SuperSU, Magisk, etc.)
 *  4. Writable system partition (/system mounted rw)
 *  5. Debuggable build flag
 */
public class RootDetector {
    private static final String TAG = "RootDetector";

    public static class Result {
        public final boolean rooted;
        public final boolean testKeys;
        public final boolean debuggable;
        public final String  details;

        Result(boolean rooted, boolean testKeys, boolean debuggable, String details) {
            this.rooted     = rooted;
            this.testKeys   = testKeys;
            this.debuggable = debuggable;
            this.details    = details;
        }

        public boolean isCompromised() {
            return rooted || testKeys || debuggable;
        }
    }

    private static final String[] ROOT_BINARIES = {
        "/system/app/Superuser.apk",
        "/sbin/su", "/system/bin/su", "/system/xbin/su",
        "/data/local/xbin/su", "/data/local/bin/su",
        "/system/bin/.ext/.su", "/system/xbin/mu",
        "/system/app/MagiskManager.apk", "/system/app/Magisk.apk",
        "/sbin/.magisk", "/sbin/.core/mirror",
        "/system/xbin/busybox", "/system/bin/busybox",
    };

    private static final String[] ROOT_PACKAGES = {
        "com.noshufou.android.su",
        "com.noshufou.android.su.elite",
        "eu.chainfire.supersu",
        "com.koushikdutta.superuser",
        "com.thirdparty.superuser",
        "com.yellowes.su",
        "com.topjohnwu.magisk",
        "me.weishu.kernelsu",
        "io.github.vvb2060.magisk",
    };

    public static Result check(Context ctx) {
        StringBuilder sb = new StringBuilder();
        boolean rooted = false;

        // 1. Root binaries
        for (String path : ROOT_BINARIES) {
            if (new File(path).exists()) {
                sb.append("root_binary:").append(path).append(";");
                rooted = true;
                Log.w(TAG, "Root binary found: " + path);
            }
        }

        // 2. Root package apps
        PackageManager pm = ctx.getPackageManager();
        for (String pkg : ROOT_PACKAGES) {
            try {
                pm.getPackageInfo(pkg, 0);
                sb.append("root_app:").append(pkg).append(";");
                rooted = true;
                Log.w(TAG, "Root app found: " + pkg);
            } catch (PackageManager.NameNotFoundException ignored) {}
        }

        // 3. Writable /system
        try {
            java.io.BufferedReader br = new java.io.BufferedReader(
                new java.io.FileReader("/proc/mounts"));
            String line;
            while ((line = br.readLine()) != null) {
                if (line.contains("/system") && line.contains("rw,")) {
                    sb.append("system_rw;");
                    rooted = true;
                    Log.w(TAG, "System partition is writable");
                    break;
                }
            }
            br.close();
        } catch (Exception ignored) {}

        // 4. Build tags
        boolean testKeys = Build.TAGS != null && Build.TAGS.contains("test-keys");
        if (testKeys) {
            sb.append("test_keys;");
            Log.w(TAG, "Device has test-keys build");
        }

        // 5. Debuggable
        boolean debuggable = Build.TYPE != null && Build.TYPE.equals("eng");
        if (debuggable) {
            sb.append("eng_build;");
        }

        String details = sb.length() > 0 ? sb.toString() : "clean";
        Result result = new Result(rooted, testKeys, debuggable, details);

        if (result.isCompromised()) {
            Log.w(TAG, "Device integrity check FAILED: " + details);
        } else {
            Log.i(TAG, "Device integrity check passed");
        }
        return result;
    }
}
