package com.fleetops.guardian.util

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Environment
import android.os.StatFs
import android.telephony.TelephonyManager
import android.util.Log

private const val TAG = "GuardianExtensions"

// ─── Battery ──────────────────────────────────────────────────────────────────

fun Context.batteryLevel(): Int {
    return try {
        val bm = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).coerceIn(0, 100)
    } catch (e: Exception) {
        Log.w(TAG, "batteryLevel: ${e.message}")
        -1
    }
}

fun Context.batteryCharging(): Boolean {
    return try {
        val filter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        val intent = registerReceiver(null, filter) ?: return false
        val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        status == BatteryManager.BATTERY_STATUS_CHARGING ||
                status == BatteryManager.BATTERY_STATUS_FULL
    } catch (e: Exception) {
        Log.w(TAG, "batteryCharging: ${e.message}")
        false
    }
}

// ─── Signal Strength ──────────────────────────────────────────────────────────

fun Context.signalStrength(): Int {
    return try {
        val tm = getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            val signal = tm.signalStrength
            if (signal != null) {
                // getLevel() returns 0-4, normalise to 0-100
                val level = signal.level
                (level * 25).coerceIn(0, 100)
            } else {
                0
            }
        } else {
            @Suppress("DEPRECATION")
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val info = cm.activeNetworkInfo
            if (info?.isConnected == true) 50 else 0
        }
    } catch (e: Exception) {
        Log.w(TAG, "signalStrength: ${e.message}")
        0
    }
}

// ─── Network Type ─────────────────────────────────────────────────────────────

fun Context.networkType(): String {
    return try {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val network = cm.activeNetwork ?: return "offline"
        val caps = cm.getNetworkCapabilities(network) ?: return "offline"

        when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> cellularType()
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "wifi"
            else -> "offline"
        }
    } catch (e: Exception) {
        Log.w(TAG, "networkType: ${e.message}")
        "offline"
    }
}

private fun Context.cellularType(): String {
    return try {
        val tm = getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
        when (tm.dataNetworkType) {
            TelephonyManager.NETWORK_TYPE_LTE,
            TelephonyManager.NETWORK_TYPE_NR -> "4g"

            TelephonyManager.NETWORK_TYPE_HSDPA,
            TelephonyManager.NETWORK_TYPE_HSUPA,
            TelephonyManager.NETWORK_TYPE_HSPA,
            TelephonyManager.NETWORK_TYPE_HSPAP,
            TelephonyManager.NETWORK_TYPE_EHRPD,
            TelephonyManager.NETWORK_TYPE_UMTS,
            TelephonyManager.NETWORK_TYPE_EVDO_0,
            TelephonyManager.NETWORK_TYPE_EVDO_A,
            TelephonyManager.NETWORK_TYPE_EVDO_B,
            TelephonyManager.NETWORK_TYPE_TD_SCDMA -> "3g"

            TelephonyManager.NETWORK_TYPE_GPRS,
            TelephonyManager.NETWORK_TYPE_EDGE,
            TelephonyManager.NETWORK_TYPE_CDMA,
            TelephonyManager.NETWORK_TYPE_1xRTT,
            TelephonyManager.NETWORK_TYPE_IDEN -> "2g"

            else -> "4g"  // Unknown cellular — assume modern
        }
    } catch (e: Exception) {
        "4g"
    }
}

// ─── Storage ──────────────────────────────────────────────────────────────────

fun Context.storageFreeM(): Int {
    return try {
        val stat = StatFs(Environment.getDataDirectory().path)
        val bytesFree = stat.availableBlocksLong * stat.blockSizeLong
        (bytesFree / (1024 * 1024)).toInt()
    } catch (e: Exception) {
        Log.w(TAG, "storageFreeM: ${e.message}")
        -1
    }
}

// ─── RAM ──────────────────────────────────────────────────────────────────────

fun Context.ramFreeM(): Int {
    return try {
        val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val info = ActivityManager.MemoryInfo()
        am.getMemoryInfo(info)
        (info.availMem / (1024 * 1024)).toInt()
    } catch (e: Exception) {
        Log.w(TAG, "ramFreeM: ${e.message}")
        -1
    }
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

fun Context.isNetworkAvailable(): Boolean = networkType() != "offline"
