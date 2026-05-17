package com.fleetops.guardian;

import android.app.*;
import android.content.*;
import android.location.*;
import android.os.*;
import android.util.Log;
import com.fleetops.guardian.R;

public class GuardianService extends Service implements LocationListener {
    private static final String TAG = "GuardianService";
    private static final int    NOTIF_ID  = 1001;
    private static final long   INTERVAL  = 30_000L;

    private DevicePrefs     prefs;
    private LocationManager locationManager;
    private Handler         handler;
    private double lastLat = 0, lastLng = 0;
    private float  lastAcc = 0;

    public static volatile boolean running = false;

    @Override
    public void onCreate() {
        super.onCreate();
        prefs           = new DevicePrefs(this);
        handler         = new Handler(Looper.getMainLooper());
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
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

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(getString(R.string.notif_text))
            .setContentIntent(pi)
            .setOngoing(true)
            .build();
    }

    private void startGps() {
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER))
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER, INTERVAL, 10f, this);
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER, INTERVAL, 10f, this);
        } catch (SecurityException e) {
            Log.w(TAG, "GPS denied: " + e.getMessage());
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
            final int    bat   = getBattery();
            final String net   = getNetwork();
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        ApiClient.heartbeat(url, token, lat, lng, acc, bat, net);
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
        lastLat = loc.getLatitude();
        lastLng = loc.getLongitude();
        lastAcc = loc.getAccuracy();
        Intent b = new Intent("com.fleetops.guardian.LOCATION");
        b.putExtra("lat", lastLat);
        b.putExtra("lng", lastLng);
        b.putExtra("accuracy", lastAcc);
        sendBroadcast(b);
    }

    @Override public void onStatusChanged(String p, int s, Bundle e) {}
    @Override public void onProviderEnabled(String p) {}
    @Override public void onProviderDisabled(String p) {}
}
