package com.sonalit.pegagent.telemetry;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.os.Looper;

import androidx.core.app.ActivityCompat;

import timber.log.Timber;

public class LocationEngine {

    private static LocationEngine instance;
    private final Context ctx;
    private final LocationManager locationManager;

    public interface LocationCallback {
        void onLocation(Location location);
    }

    private LocationEngine(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.locationManager = (LocationManager) this.ctx.getSystemService(Context.LOCATION_SERVICE);
    }

    public static synchronized LocationEngine getInstance(Context ctx) {
        if (instance == null) instance = new LocationEngine(ctx);
        return instance;
    }

    public void getLocationNow(LocationCallback callback) {
        if (ActivityCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED
            && ActivityCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            Timber.w("Location permission denied");
            callback.onLocation(null);
            return;
        }

        if (locationManager == null) {
            callback.onLocation(null);
            return;
        }

        // Try GPS first, fall back to network
        Location best = null;
        try {
            Location gps = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            Location net = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if (gps != null && net != null) {
                best = gps.getAccuracy() <= net.getAccuracy() ? gps : net;
            } else {
                best = gps != null ? gps : net;
            }
        } catch (Exception e) {
            Timber.e(e, "getLastKnownLocation failed");
        }

        if (best != null) {
            Timber.d("Location fix (cached): %.6f, %.6f acc=%.1f",
                    best.getLatitude(), best.getLongitude(), best.getAccuracy());
            callback.onLocation(best);
            return;
        }

        // No cached fix — request a single update
        try {
            final Location[] result = {null};
            android.location.LocationListener listener = new android.location.LocationListener() {
                @Override
                public void onLocationChanged(Location location) {
                    result[0] = location;
                    try { locationManager.removeUpdates(this); } catch (Exception ignored) {}
                    Timber.d("Location fix (fresh): %.6f, %.6f", location.getLatitude(), location.getLongitude());
                    callback.onLocation(location);
                }
            };
            locationManager.requestSingleUpdate(LocationManager.GPS_PROVIDER, listener, Looper.getMainLooper());
        } catch (Exception e) {
            Timber.e(e, "requestSingleUpdate failed");
            callback.onLocation(null);
        }
    }
}
