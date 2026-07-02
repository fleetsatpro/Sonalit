package com.sonalit.pegagent.telemetry;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.telephony.PhoneStateListener;
import android.telephony.SignalStrength;
import android.telephony.TelephonyCallback;
import android.telephony.TelephonyManager;

import androidx.core.app.ActivityCompat;

import com.sonalit.pegagent.network.PegApiClient;
import com.sonalit.pegagent.util.PegConfig;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import timber.log.Timber;

/**
 * TelemetryEngine — periodic heartbeat with real location + cellular signal.
 *
 * Signal sampling is folded in here (P2-3): the standalone TelemetryService was
 * never started and would have crashed as an FGS, so it has been removed. We use
 * {@link TelephonyCallback} on API 31+ and fall back to the deprecated
 * {@link PhoneStateListener} on API 26-30.
 */
public class TelemetryEngine {

    private final Context ctx;
    private final PegApiClient api;
    private final LocationManager locationManager;
    private final TelephonyManager telephonyManager;
    private final Handler handler;
    private final AtomicReference<Location> lastLocation = new AtomicReference<>();
    private final AtomicInteger lastSignalPct = new AtomicInteger(-1);
    private boolean running = false;

    private Object telephonyCallback; // TelephonyCallback (API 31+)
    private PhoneStateListener phoneStateListener; // API 26-30

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
        this.telephonyManager = (TelephonyManager) this.ctx.getSystemService(Context.TELEPHONY_SERVICE);
        this.handler = new Handler(Looper.getMainLooper());
    }

    public void start() {
        running = true;
        startLocationUpdates();
        startSignalUpdates();
        handler.postDelayed(heartbeatRunnable, 5_000);
        Timber.i("TelemetryEngine started");
    }

    public void stop() {
        running = false;
        handler.removeCallbacks(heartbeatRunnable);
        try {
            if (locationManager != null) locationManager.removeUpdates(locationListener);
        } catch (Exception ignored) {}
        stopSignalUpdates();
        Timber.i("TelemetryEngine stopped");
    }

    private void startLocationUpdates() {
        if (locationManager == null) return;
        if (ActivityCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED
            && ActivityCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            Timber.w("Location permission not granted");
            return;
        }
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER, PegConfig.LOCATION_INTERVAL_MS,
                        PegConfig.LOCATION_MIN_DISTANCE, locationListener, Looper.getMainLooper());
            }
            // Network provider as a fallback so we still get fixes indoors / cold GPS.
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.NETWORK_PROVIDER, PegConfig.LOCATION_INTERVAL_MS,
                        PegConfig.LOCATION_MIN_DISTANCE, locationListener, Looper.getMainLooper());
            }
            Timber.i("Location updates requested");
        } catch (Exception e) {
            Timber.e(e, "requestLocationUpdates failed");
        }
    }

    private void startSignalUpdates() {
        if (telephonyManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                TelephonyCallback cb = new SignalCallback();
                telephonyCallback = cb;
                telephonyManager.registerTelephonyCallback(ctx.getMainExecutor(), cb);
            } else {
                phoneStateListener = new PhoneStateListener() {
                    @Override
                    public void onSignalStrengthsChanged(SignalStrength sig) {
                        updateSignal(sig);
                    }
                };
                telephonyManager.listen(phoneStateListener, PhoneStateListener.LISTEN_SIGNAL_STRENGTHS);
            }
        } catch (Throwable t) {
            Timber.w(t, "Signal listener registration failed");
        }
    }

    private void stopSignalUpdates() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                    && telephonyCallback instanceof TelephonyCallback && telephonyManager != null) {
                telephonyManager.unregisterTelephonyCallback((TelephonyCallback) telephonyCallback);
            } else if (phoneStateListener != null && telephonyManager != null) {
                telephonyManager.listen(phoneStateListener, PhoneStateListener.LISTEN_NONE);
            }
        } catch (Throwable ignored) {}
    }

    private class SignalCallback extends TelephonyCallback
            implements TelephonyCallback.SignalStrengthsListener {
        @Override
        public void onSignalStrengthsChanged(SignalStrength signalStrength) {
            updateSignal(signalStrength);
        }
    }

    private void updateSignal(SignalStrength sig) {
        if (sig == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    && sig.getCellSignalStrengths() != null
                    && !sig.getCellSignalStrengths().isEmpty()) {
                int asu = sig.getCellSignalStrengths().get(0).getAsuLevel();
                if (asu >= 0 && asu != 99) {
                    lastSignalPct.set(Math.min(100, (asu * 100) / 31));
                    return;
                }
            }
            // Pre-29 (and fallback): getLevel() returns 0-4.
            int level = sig.getLevel();
            if (level >= 0) lastSignalPct.set(Math.min(100, level * 25));
        } catch (Throwable ignored) {}
    }

    private void sendHeartbeat() {
        Location loc = lastLocation.get();
        PegApiClient.TelemetryPayload payload =
                PegApiClient.TelemetryPayload.build(ctx, loc, lastSignalPct.get());
        api.sendTelemetry(payload);
    }

    public void getLocationNow(LocationEngine.LocationCallback callback) {
        LocationEngine.getInstance(ctx).getLocationNow(callback);
    }
}
