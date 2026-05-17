package com.fleetops.guardian;

import android.app.*;
import android.content.*;
import android.location.*;
import android.os.*;
import android.util.Log;
import com.fleetops.guardian.R;

public class GuardianService extends Service implements LocationListener {
    private static final String TAG      = "GuardianService";
    private static final int    NOTIF_ID = 1001;
    private static final String CHANNEL  = "guardian_tracking";
    private static final long   INTERVAL = 30_000L;

    private DevicePrefs     prefs;
    private LocationManager locationManager;
    private Handler         handler;

    // Shared state — read by MainActivity via broadcast
    public static volatile double lastLat   = 0;
    public static volatile double lastLng   = 0;
    public static volatile float  lastAcc   = 0;
    public static volatile float  lastSpeed = 0;
    public static volatile boolean running  = false;

    @Override
    public void onCreate() {
        super.onCreate();
        prefs           = new DevicePrefs(this);
        handler         = new Handler(Looper.getMainLooper());
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        running = true;
        startForeground(NOTIF_ID, buildNotification());
        startGps();
        handler.postDelayed(heartbeat, INTERVAL);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        try { locationManager.removeUpdates(this); } catch (Exception ignored) {}
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    // Create notification channel for Android 8+ using reflection so the code
    // still compiles against API 23 but behaves correctly at runtime on API 26+.
    private void createNotificationChannel() {
        if (android.os.Build.VERSION.SDK_INT < 26) return;
        try {
            Class<?> channelClass = Class.forName("android.app.NotificationChannel");
            Object channel = channelClass
                .getConstructor(String.class, CharSequence.class, int.class)
                .newInstance(CHANNEL, getString(R.string.channel_name), 2); // IMPORTANCE_LOW = 2
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.getClass().getMethod("createNotificationChannel", channelClass).invoke(nm, channel);
        } catch (Exception e) {
            Log.w(TAG, "Failed to create notification channel: " + e.getMessage());
        }
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);

        // FLAG_IMMUTABLE available since API 23 — prevents apps from modifying
        // our PendingIntent, and required by Android 12+ for mutable/immutable clarity.
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, piFlags);

        Notification.Builder b = new Notification.Builder(this)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(getString(R.string.notif_text))
            .setContentIntent(pi)
            .setOngoing(true);

        // Set channel on Android 8+
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            try {
                b.getClass().getMethod("setChannelId", String.class).invoke(b, CHANNEL);
            } catch (Exception ignored) {}
        }

        return b.build();
    }

    private void startGps() {
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER))
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER, INTERVAL, 5f, this);
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER, INTERVAL, 10f, this);
        } catch (SecurityException e) {
            Log.w(TAG, "GPS permission not granted: " + e.getMessage());
        }
    }

    private final Runnable heartbeat = new Runnable() {
        @Override
        public void run() {
            final String url   = prefs.getServerUrl();
            final String token = prefs.getToken();
            final double lat   = lastLat;
            final double lng   = lastLng;
            final float  acc   = lastAcc;
            final float  spd   = lastSpeed;
            final int    bat   = getBattery();
            final String net   = getNetwork();
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        ApiClient.heartbeat(url, token, lat, lng, acc, spd, bat, net);
                    } catch (Exception e) {
                        Log.e(TAG, "heartbeat error", e);
                    }
                }
            }).start();
            handler.postDelayed(this, INTERVAL);
        }
    };

    private int getBattery() {
        Intent bat = registerReceiver(null,
            new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (bat == null) return -1;
        int level = bat.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = bat.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        return (level >= 0 && scale > 0) ? (int)(100f * level / scale) : -1;
    }

    private String getNetwork() {
        android.net.ConnectivityManager cm =
            (android.net.ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (cm == null) return "unknown";
        android.net.NetworkInfo ni = cm.getActiveNetworkInfo();
        if (ni == null || !ni.isConnected()) return "none";
        return ni.getTypeName();
    }

    @Override
    public void onLocationChanged(Location loc) {
        lastLat   = loc.getLatitude();
        lastLng   = loc.getLongitude();
        lastAcc   = loc.getAccuracy();
        lastSpeed = loc.getSpeed();

        Intent b = new Intent("com.fleetops.guardian.LOCATION");
        b.putExtra("lat",      lastLat);
        b.putExtra("lng",      lastLng);
        b.putExtra("accuracy", lastAcc);
        b.putExtra("speed",    lastSpeed);
        sendBroadcast(b);
    }

    @Override public void onStatusChanged(String p, int s, Bundle e) {}
    @Override public void onProviderEnabled(String p) {}
    @Override public void onProviderDisabled(String p) {}
}
