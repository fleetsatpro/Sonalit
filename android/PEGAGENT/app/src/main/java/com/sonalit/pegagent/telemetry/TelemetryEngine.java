package com.sonalit.pegagent.telemetry;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Handler;
import android.os.Looper;

import androidx.core.app.ActivityCompat;

import com.sonalit.pegagent.network.PegApiClient;
import com.sonalit.pegagent.util.PegConfig;

import java.util.concurrent.atomic.AtomicReference;

import timber.log.Timber;

public class TelemetryEngine {

    private final Context ctx;
    private final PegApiClient api;
    private final LocationManager locationManager;
    private final Handler handler;
    private final AtomicReference<Location> lastLocation = new AtomicReference<>();
    private boolean running = false;

    private final LocationListener locationListener = new LocationListener() {
        @Override
        public void onLocationChanged(Location location) {
            lastLocation.set(location);
            Timber.v("Location update: %.6f, %.6f acc=%.1fm",
                    location.getLatitude(), location.getLongitude(), location.getAccuracy());
        }
    };

    private final Runnable heartbeatRunnable = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            sendHeartbeat();
            handler.postDelayed(this, PegConfig.TELEMETRY_INTERVAL_MS);
        }
    };

    public TelemetryEngine(Context ctx, PegApiClient api) {
        this.ctx = ctx.getApplicationContext();
        this.api = api;
        this.locationManager = (LocationManager) this.ctx.getSystemService(Context.LOCATION_SERVICE);
        this.handler = new Handler(Looper.getMainLooper());
    }

    public void start() {
        running = true;
        startLocationUpdates();
        handler.postDelayed(heartbeatRunnable, 5_000);
        Timber.i("TelemetryEngine started");
    }

    public void stop() {
        running = false;
        handler.removeCallbacks(heartbeatRunnable);
        try {
            if (locationManager != null) locationManager.removeUpdates(locationListener);
        } catch (Exception ignored) {}
        Timber.i("TelemetryEngine stopped");
    }

    private void startLocationUpdates() {
        if (locationManager == null) return;
        if (ActivityCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            Timber.w("Location permission not granted");
            return;
        }
        try {
            locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    PegConfig.LOCATION_INTERVAL_MS,
                    PegConfig.LOCATION_MIN_DISTANCE,
                    locationListener,
                    Looper.getMainLooper());
            Timber.i("Location updates requested");
        } catch (Exception e) {
            Timber.e(e, "requestLocationUpdates failed");
        }
    }

    private void sendHeartbeat() {
        Location loc = lastLocation.get();
        PegApiClient.TelemetryPayload payload = PegApiClient.TelemetryPayload.build(ctx, loc);
        api.sendTelemetry(payload);
    }

    public void getLocationNow(LocationEngine.LocationCallback callback) {
        LocationEngine.getInstance(ctx).getLocationNow(callback);
    }
}
