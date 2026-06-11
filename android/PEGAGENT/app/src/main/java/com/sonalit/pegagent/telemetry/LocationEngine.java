package com.sonalit.pegagent.telemetry;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;

import androidx.core.app.ActivityCompat;

import com.google.android.gms.location.CurrentLocationRequest;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationToken;
import com.google.android.gms.tasks.OnTokenCanceledListener;

import timber.log.Timber;

public class LocationEngine {

    private static LocationEngine instance;
    private final Context ctx;
    private final FusedLocationProviderClient fusedLocation;

    public interface LocationCallback {
        void onLocation(Location location);
    }

    private LocationEngine(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.fusedLocation = LocationServices.getFusedLocationProviderClient(this.ctx);
    }

    public static synchronized LocationEngine getInstance(Context ctx) {
        if (instance == null) instance = new LocationEngine(ctx);
        return instance;
    }

    /**
     * Get best current location — high accuracy, no timeout wait.
     * Uses getCurrentLocation() which returns the best available fix immediately.
     */
    public void getLocationNow(LocationCallback callback) {
        if (ActivityCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            Timber.w("Location permission denied");
            callback.onLocation(null);
            return;
        }

        CancellationToken ct = new CancellationToken() {
            @Override
            public boolean isCancellationRequested() { return false; }
            @Override
            public CancellationToken onCanceledRequested(OnTokenCanceledListener listener) { return this; }
        };

        fusedLocation.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, ct)
                .addOnSuccessListener(location -> {
                    if (location != null) {
                        Timber.d("Location fix: %.6f, %.6f acc=%.1f",
                                location.getLatitude(), location.getLongitude(),
                                location.getAccuracy());
                        callback.onLocation(location);
                    } else {
                        // Fallback: get last known location
                        fusedLocation.getLastLocation()
                                .addOnSuccessListener(callback::onLocation)
                                .addOnFailureListener(e -> callback.onLocation(null));
                    }
                })
                .addOnFailureListener(e -> {
                    Timber.e(e, "getCurrentLocation failed");
                    callback.onLocation(null);
                });
    }
}
