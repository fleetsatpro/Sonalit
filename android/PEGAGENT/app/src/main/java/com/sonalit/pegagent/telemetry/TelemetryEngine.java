package com.sonalit.pegagent.telemetry;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Handler;
import android.os.Looper;

import androidx.core.app.ActivityCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.sonalit.pegagent.network.PegApiClient;
import com.sonalit.pegagent.util.PegConfig;

import java.util.concurrent.atomic.AtomicReference;

import timber.log.Timber;

public class TelemetryEngine {

    private final Context ctx;
    private final PegApiClient api;
    private final FusedLocationProviderClient fusedLocation;
    private final Handler handler;
    private final AtomicReference<Location> lastLocation = new AtomicReference<>();
    private boolean running = false;

    private final LocationCallback locationCallback = new LocationCallback() {
        @Override
        public void onLocationResult(LocationResult result) {
            if (result == null) return;
            Location loc = result.getLastLocation();
            if (loc != null) {
                lastLocation.set(loc);
                Timber.v("Location update: %.6f, %.6f acc=%.1fm",
                        loc.getLatitude(), loc.getLongitude(), loc.getAccuracy());
            }
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
        this.fusedLocation = LocationServices.getFusedLocationProviderClient(ctx);
        this.handler = new Handler(Looper.getMainLooper());
    }

    public void start() {
        running = true;
        startLocationUpdates();
        handler.postDelayed(heartbeatRunnable, 5_000); // first heartbeat after 5s
        Timber.i("TelemetryEngine started");
    }

    public void stop() {
        running = false;
        handler.removeCallbacks(heartbeatRunnable);
        fusedLocation.removeLocationUpdates(locationCallback);
        Timber.i("TelemetryEngine stopped");
    }

    private void startLocationUpdates() {
        if (ActivityCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            Timber.w("Location permission not granted");
            return;
        }

        LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY,
                PegConfig.LOCATION_INTERVAL_MS)
                .setMinUpdateIntervalMillis(PegConfig.LOCATION_FASTEST_MS)
                .setMinUpdateDistanceMeters(PegConfig.LOCATION_MIN_DISTANCE)
                .build();

        fusedLocation.requestLocationUpdates(req, locationCallback, Looper.getMainLooper());
        Timber.i("Location updates requested");
    }

    private void sendHeartbeat() {
        Location loc = lastLocation.get();
        PegApiClient.TelemetryPayload payload = PegApiClient.TelemetryPayload.build(ctx, loc);
        api.sendTelemetry(payload);
    }

    /** Get current location immediately for request_location command */
    public void getLocationNow(LocationEngine.LocationCallback callback) {
        LocationEngine.getInstance(ctx).getLocationNow(callback);
    }
}
