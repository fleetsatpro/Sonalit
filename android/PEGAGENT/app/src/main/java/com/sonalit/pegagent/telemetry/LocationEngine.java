package com.sonalit.pegagent.telemetry;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;

import androidx.core.app.ActivityCompat;

import java.util.concurrent.atomic.AtomicBoolean;

import timber.log.Timber;

/**
 * LocationEngine — single-shot location fixes.
 *
 * {@link #getLocationNow} tries for a fresh fix (getCurrentLocation on API 30+,
 * requestSingleUpdate below that) and falls back to last-known.
 * {@link #getFreshLocation} adds a hard timeout and reports whether the returned
 * fix is stale (last-known) — used by the SOS pipeline which must not block more
 * than a few seconds (P0-1).
 */
public class LocationEngine {

    private static LocationEngine instance;
    private final Context ctx;
    private final LocationManager locationManager;
    private final Handler main = new Handler(Looper.getMainLooper());

    public interface LocationCallback {
        void onLocation(Location location);
    }

    /** stale=true means the fix is last-known rather than a fresh reading. */
    public interface FreshCallback {
        void onLocation(Location location, boolean stale);
    }

    private LocationEngine(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.locationManager = (LocationManager) this.ctx.getSystemService(Context.LOCATION_SERVICE);
    }

    public static synchronized LocationEngine getInstance(Context ctx) {
        if (instance == null) instance = new LocationEngine(ctx);
        return instance;
    }

    private boolean hasPermission() {
        return ActivityCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED
            || ActivityCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private Location lastKnown() {
        if (locationManager == null || !hasPermission()) return null;
        try {
            Location gps = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            Location net = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            if (gps != null && net != null) return gps.getAccuracy() <= net.getAccuracy() ? gps : net;
            return gps != null ? gps : net;
        } catch (Exception e) {
            Timber.e(e, "getLastKnownLocation failed");
            return null;
        }
    }

    public void getLocationNow(LocationCallback callback) {
        getFreshLocation(8_000L, (loc, stale) -> callback.onLocation(loc));
    }

    /**
     * Request a fresh fix, falling back to last-known after {@code timeoutMs}.
     * Always invokes the callback exactly once on the main thread.
     */
    public void getFreshLocation(long timeoutMs, FreshCallback callback) {
        if (locationManager == null || !hasPermission()) {
            Timber.w("Location unavailable (no permission/manager)");
            callback.onLocation(lastKnown(), true);
            return;
        }

        final AtomicBoolean done = new AtomicBoolean(false);
        final CancellationSignal cancel = new CancellationSignal();

        final Runnable timeoutFallback = () -> {
            if (done.compareAndSet(false, true)) {
                try { cancel.cancel(); } catch (Exception ignored) {}
                Location lk = lastKnown();
                Timber.d("Fresh fix timed out — using %s", lk != null ? "last-known" : "none");
                callback.onLocation(lk, true);
            }
        };
        main.postDelayed(timeoutFallback, timeoutMs);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                String provider = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)
                        ? LocationManager.GPS_PROVIDER : LocationManager.NETWORK_PROVIDER;
                locationManager.getCurrentLocation(provider, cancel, ctx.getMainExecutor(), loc -> {
                    if (done.compareAndSet(false, true)) {
                        main.removeCallbacks(timeoutFallback);
                        if (loc != null) {
                            callback.onLocation(loc, false);
                        } else {
                            callback.onLocation(lastKnown(), true);
                        }
                    }
                });
            } else {
                android.location.LocationListener listener = new android.location.LocationListener() {
                    @Override public void onLocationChanged(Location location) {
                        if (done.compareAndSet(false, true)) {
                            main.removeCallbacks(timeoutFallback);
                            try { locationManager.removeUpdates(this); } catch (Exception ignored) {}
                            callback.onLocation(location, false);
                        }
                    }
                    @Override public void onProviderDisabled(String p) {}
                    @Override public void onProviderEnabled(String p) {}
                    @Override public void onStatusChanged(String p, int s, android.os.Bundle e) {}
                };
                String provider = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)
                        ? LocationManager.GPS_PROVIDER : LocationManager.NETWORK_PROVIDER;
                locationManager.requestSingleUpdate(provider, listener, Looper.getMainLooper());
            }
        } catch (Exception e) {
            Timber.e(e, "Fresh location request failed");
            if (done.compareAndSet(false, true)) {
                main.removeCallbacks(timeoutFallback);
                callback.onLocation(lastKnown(), true);
            }
        }
    }
}
