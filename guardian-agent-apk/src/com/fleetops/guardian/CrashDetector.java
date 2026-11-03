package com.fleetops.guardian;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;

public class CrashDetector implements SensorEventListener {
    // Net acceleration threshold above gravity (≈3.6G net = serious impact)
    private static final float CRASH_THRESHOLD_MS2 = 35.0f;
    private static final long  COOLDOWN_MS          = 8000L;

    public interface Callback {
        void onCrashDetected(float magnitude);
    }

    private final SensorManager sensorManager;
    private final Callback      callback;
    private long lastTrigger = 0;

    public CrashDetector(Context ctx, Callback callback) {
        this.sensorManager = (SensorManager) ctx.getSystemService(Context.SENSOR_SERVICE);
        this.callback = callback;
    }

    public void start() {
        Sensor accel = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        if (accel != null) {
            sensorManager.registerListener(this, accel, SensorManager.SENSOR_DELAY_NORMAL);
        }
    }

    public void stop() {
        sensorManager.unregisterListener(this);
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        float x = event.values[0];
        float y = event.values[1];
        float z = event.values[2];
        float magnitude = (float) Math.sqrt(x * x + y * y + z * z);
        float net = Math.abs(magnitude - SensorManager.GRAVITY_EARTH);
        long now = System.currentTimeMillis();
        if (net > CRASH_THRESHOLD_MS2 && (now - lastTrigger) > COOLDOWN_MS) {
            lastTrigger = now;
            callback.onCrashDetected(net);
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}
}
