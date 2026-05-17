package com.fleetops.guardian;

import android.app.*;
import android.content.*;
import android.location.*;
import android.os.*;
import android.util.Log;
import com.fleetops.guardian.R;
import java.util.List;

public class GuardianService extends Service implements LocationListener {
    private static final String TAG        = "GuardianService";
    private static final int    NOTIF_ID   = 1001;
    private static final String CHANNEL    = "guardian_tracking";
    private static final long   INTERVAL   = 30_000L;
    private static final long   INTERVAL_FAST = 5_000L;
    private static final long   QUEUE_RETRY_INTERVAL = 5 * 60_000L;

    private DevicePrefs     prefs;
    private LocationManager locationManager;
    private Handler         handler;
    private OfflineQueue    offlineQueue;
    private CrashDetector   crashDetector;
    private CommandHandler  commandHandler;

    // Shared state — read by MainActivity via broadcast
    public static volatile double  lastLat   = 0;
    public static volatile double  lastLng   = 0;
    public static volatile float   lastAcc   = 0;
    public static volatile float   lastSpeed = 0;
    public static volatile boolean running   = false;
    public static volatile long    dmsDeadlineMs = 0; // epoch ms when DMS fires

    private boolean fastTracking = false;
    private long    dmsIntervalMs = 0;

    // ── Broadcast receivers ───────────────────────────────────────────────────

    private final BroadcastReceiver controlReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            String action = intent.getAction();
            if ("com.fleetops.guardian.FORCE_HEARTBEAT".equals(action)) {
                handler.post(heartbeat);
            } else if ("com.fleetops.guardian.FORCE_SYNC".equals(action)) {
                handler.post(queueRetry);
            } else if ("com.fleetops.guardian.SET_TRACKING_RATE".equals(action)) {
                boolean fast = intent.getBooleanExtra("fast", false);
                setFastTracking(fast);
            } else if ("com.fleetops.guardian.DMS_CHECKIN".equals(action)) {
                resetDmsTimer();
            } else if ("com.fleetops.guardian.PANIC".equals(action)) {
                String mode = intent.getStringExtra("mode");
                triggerPanic(mode);
            } else if ("com.fleetops.guardian.REQUEST_FRESH_LOCATION".equals(action)) {
                String cmdId = intent.getStringExtra("command_id");
                requestFreshLocation(cmdId);
            }
        }
    };

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    @Override
    public void onCreate() {
        super.onCreate();
        prefs           = new DevicePrefs(this);
        handler         = new Handler(Looper.getMainLooper());
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
        offlineQueue    = new OfflineQueue(this);

        commandHandler = new CommandHandler(this, new CommandHandler.Listener() {
            @Override
            public void onHandled(final String cmdId, final boolean ok, final String result) {
                new Thread(new Runnable() {
                    @Override public void run() {
                        ApiClient.ackCommand(
                            prefs.getServerUrl(), prefs.getToken(), cmdId, ok, result);
                    }
                }).start();
            }
        });

        crashDetector = new CrashDetector(this, new CrashDetector.Callback() {
            @Override
            public void onCrashDetected(float magnitude) {
                Log.w(TAG, "Crash detected! magnitude=" + magnitude);
                triggerPanic("medical");
                sendBroadcast(new Intent("com.fleetops.guardian.CRASH_DETECTED")
                    .putExtra("magnitude", magnitude));
            }
        });

        createNotificationChannel();
        registerControlReceiver();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        running = true;
        startForeground(NOTIF_ID, buildNotification());
        startGps();
        crashDetector.start();
        scheduleHeartbeat();
        scheduleQueueRetry();
        if (prefs.isDmsEnabled()) resetDmsTimer();
        // Initialize cert pinning from stored prefs
        ApiClient.pinnedSha256 = prefs.getCertPinSha256();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        crashDetector.stop();
        try { locationManager.removeUpdates(this); } catch (Exception ignored) {}
        try { unregisterReceiver(controlReceiver); } catch (Exception ignored) {}
        SirenController.getInstance(this).stop();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    // ── GPS ───────────────────────────────────────────────────────────────────

    private void startGps() {
        long interval = fastTracking ? INTERVAL_FAST : INTERVAL;
        try { locationManager.removeUpdates(this); } catch (Exception ignored) {}
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER))
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER, interval, 5f, this);
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER, interval, 10f, this);
        } catch (SecurityException e) {
            Log.w(TAG, "GPS permission denied: " + e.getMessage());
        }
    }

    private void setFastTracking(boolean fast) {
        fastTracking = fast;
        startGps();
        Log.i(TAG, "Tracking rate: " + (fast ? "FAST 5s" : "NORMAL 30s"));
    }

    // ── Heartbeat ─────────────────────────────────────────────────────────────

    private void scheduleHeartbeat() {
        handler.postDelayed(heartbeat, INTERVAL);
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
                        ApiClient.HeartbeatResult result =
                            ApiClient.heartbeat(url, token, lat, lng, acc, spd, bat, net);
                        if (result.upgradeRequired) {
                            Intent upg = new Intent("com.fleetops.guardian.UPGRADE_REQUIRED");
                            upg.putExtra("min_version_code", result.minVersionCode);
                            upg.putExtra("download_url", result.downloadUrl);
                            sendBroadcast(upg);
                            return;
                        }
                        for (ApiClient.PendingCommand cmd : result.commands) {
                            commandHandler.handle(cmd.id, cmd.type, cmd.payload,
                                cmd.issuedAt, cmd.signature);
                        }
                        // Fetch config and update DMS interval if not user-customized
                        org.json.JSONObject config = ApiClient.fetchConfig(url, token);
                        if (config != null && !prefs.isDmsIntervalCustomized()) {
                            int serverInterval = config.optInt("dms_default_interval_minutes", 0);
                            if (serverInterval > 0) {
                                prefs.setDmsIntervalMinutes(serverInterval);
                            }
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "heartbeat error", e);
                    }
                }
            }).start();

            long interval = fastTracking ? INTERVAL_FAST : INTERVAL;
            handler.postDelayed(this, interval);
        }
    };

    // ── Offline queue retry ───────────────────────────────────────────────────

    private void scheduleQueueRetry() {
        handler.postDelayed(queueRetry, QUEUE_RETRY_INTERVAL);
    }

    private final Runnable queueRetry = new Runnable() {
        @Override
        public void run() {
            final String url   = prefs.getServerUrl();
            final String token = prefs.getToken();
            final List<OfflineQueue.Item> items = offlineQueue.getPending();
            if (!items.isEmpty()) {
                new Thread(new Runnable() {
                    @Override
                    public void run() {
                        for (OfflineQueue.Item item : items) {
                            boolean ok = replayItem(url, token, item);
                            if (ok) offlineQueue.markSent(item.id);
                            else    offlineQueue.markAttempted(item.id, item.type, item.createdAt);
                        }
                        broadcastQueueCount();
                    }
                }).start();
            }
            handler.postDelayed(this, QUEUE_RETRY_INTERVAL);
        }
    };

    private boolean replayItem(String url, String token, OfflineQueue.Item item) {
        try {
            String endpoint;
            if ("panic".equals(item.type))      endpoint = "/api/v1/guardian/panic";
            else if ("report".equals(item.type)) endpoint = "/api/v1/guardian/report";
            else                                 return true; // drop unknown
            String resp = ApiClient.post(url + endpoint, token, item.payload);
            return resp != null;
        } catch (Exception e) {
            return false;
        }
    }

    private void broadcastQueueCount() {
        int count      = offlineQueue.getPendingCount();
        int permFailed = offlineQueue.getFailedPermanentCount();
        sendBroadcast(new Intent("com.fleetops.guardian.QUEUE_COUNT")
            .putExtra("count", count)
            .putExtra("failed_permanent", permFailed));
    }

    // ── Panic ─────────────────────────────────────────────────────────────────

    void triggerPanic(final String mode) {
        final String url       = prefs.getServerUrl();
        final String token     = prefs.getToken();
        final double lat       = lastLat;
        final double lng       = lastLng;
        final String eventUuid = ApiClient.newEventUuid();

        new Thread(new Runnable() {
            @Override
            public void run() {
                boolean ok = ApiClient.sendPanic(url, token, mode, lat, lng, eventUuid);
                if (!ok) {
                    // Build offline payload
                    try {
                        org.json.JSONObject body = new org.json.JSONObject();
                        body.put("mode", mode);
                        body.put("lat", lat);
                        body.put("lng", lng);
                        body.put("event_uuid", eventUuid);
                        offlineQueue.enqueue("panic", body.toString());
                        broadcastQueueCount();
                    } catch (Exception ignored) {}
                }
            }
        }).start();
    }

    // ── Dead man's switch ─────────────────────────────────────────────────────

    void resetDmsTimer() {
        handler.removeCallbacks(dmsTimeout);
        if (!prefs.isDmsEnabled()) {
            dmsDeadlineMs = 0;
            return;
        }
        dmsIntervalMs = prefs.getDmsIntervalMinutes() * 60_000L;
        dmsDeadlineMs = System.currentTimeMillis() + dmsIntervalMs;
        handler.postDelayed(dmsTimeout, dmsIntervalMs);
        sendBroadcast(new Intent("com.fleetops.guardian.DMS_RESET")
            .putExtra("deadline", dmsDeadlineMs));
        Log.i(TAG, "DMS reset: deadline in " + prefs.getDmsIntervalMinutes() + " min");
    }

    private final Runnable dmsTimeout = new Runnable() {
        @Override
        public void run() {
            Log.w(TAG, "DMS timeout — triggering silent panic");
            triggerPanic("silent");
            dmsDeadlineMs = 0;
            sendBroadcast(new Intent("com.fleetops.guardian.DMS_FIRED"));
        }
    };

    // ── Notification ─────────────────────────────────────────────────────────

    private void createNotificationChannel() {
        if (android.os.Build.VERSION.SDK_INT < 26) return;
        try {
            Class<?> cls = Class.forName("android.app.NotificationChannel");
            Object ch = cls.getConstructor(String.class, CharSequence.class, int.class)
                .newInstance(CHANNEL, getString(R.string.channel_name), 2);
            NotificationManager nm =
                (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.getClass().getMethod("createNotificationChannel", cls).invoke(nm, ch);
        } catch (Exception e) {
            Log.w(TAG, "channel error: " + e.getMessage());
        }
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, piFlags);

        Notification.Builder b = new Notification.Builder(this)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(getString(R.string.notif_text))
            .setContentIntent(pi)
            .setOngoing(true);

        if (android.os.Build.VERSION.SDK_INT >= 26) {
            try {
                b.getClass().getMethod("setChannelId", String.class).invoke(b, CHANNEL);
            } catch (Exception ignored) {}
        }
        return b.build();
    }

    // ── Receivers ─────────────────────────────────────────────────────────────

    private void registerControlReceiver() {
        IntentFilter f = new IntentFilter();
        f.addAction("com.fleetops.guardian.FORCE_HEARTBEAT");
        f.addAction("com.fleetops.guardian.FORCE_SYNC");
        f.addAction("com.fleetops.guardian.SET_TRACKING_RATE");
        f.addAction("com.fleetops.guardian.DMS_CHECKIN");
        f.addAction("com.fleetops.guardian.PANIC");
        f.addAction("com.fleetops.guardian.REQUEST_FRESH_LOCATION");
        registerReceiver(controlReceiver, f);
    }

    // ── System helpers ────────────────────────────────────────────────────────

    private int getBattery() {
        Intent bat = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
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

    // ── One-shot fresh location for request_location command ─────────────────

    private static final long FRESH_LOCATION_TIMEOUT_MS = 15_000L;

    private void requestFreshLocation(final String commandId) {
        final String url   = prefs.getServerUrl();
        final String token = prefs.getToken();

        // Two-element arrays used so listener and timeout can reference each other.
        final LocationListener[] listenerRef = new LocationListener[1];
        final Runnable[]         timeoutRef  = new Runnable[1];

        listenerRef[0] = new LocationListener() {
            private volatile boolean done = false;
            @Override
            public void onLocationChanged(final Location loc) {
                if (done) return;
                done = true;
                handler.removeCallbacks(timeoutRef[0]);
                try { locationManager.removeUpdates(listenerRef[0]); } catch (Exception ignored) {}

                // Update shared state so the next heartbeat uses this fresh fix
                lastLat   = loc.getLatitude();
                lastLng   = loc.getLongitude();
                lastAcc   = loc.getAccuracy();
                lastSpeed = loc.getSpeed();

                new Thread(new Runnable() {
                    @Override public void run() {
                        ApiClient.sendLocation(url, token,
                            loc.getLatitude(), loc.getLongitude(),
                            loc.getAltitude(), loc.getBearing(),
                            loc.getSpeed(),   loc.getAccuracy());
                        ApiClient.ackCommand(url, token, commandId, true, "location_sent");
                    }
                }).start();
                Log.i(TAG, "Fresh location fix obtained for cmd=" + commandId);
            }
            @Override public void onStatusChanged(String p, int s, Bundle e) {}
            @Override public void onProviderEnabled(String p) {}
            @Override public void onProviderDisabled(String p) {}
        };

        timeoutRef[0] = new Runnable() {
            @Override public void run() {
                try { locationManager.removeUpdates(listenerRef[0]); } catch (Exception ignored) {}
                new Thread(new Runnable() {
                    @Override public void run() {
                        ApiClient.ackCommand(url, token, commandId, false, "no_gps_fix");
                    }
                }).start();
                Log.w(TAG, "Fresh location timed out (15s) for cmd=" + commandId);
            }
        };

        boolean registered = false;
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestSingleUpdate(
                    LocationManager.GPS_PROVIDER, listenerRef[0], Looper.getMainLooper());
                registered = true;
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestSingleUpdate(
                    LocationManager.NETWORK_PROVIDER, listenerRef[0], Looper.getMainLooper());
                registered = true;
            }
        } catch (SecurityException e) {
            Log.w(TAG, "Location permission denied for fresh fix: " + e.getMessage());
        }

        if (!registered) {
            new Thread(new Runnable() {
                @Override public void run() {
                    ApiClient.ackCommand(url, token, commandId, false, "no_gps_fix");
                }
            }).start();
            return;
        }

        handler.postDelayed(timeoutRef[0], FRESH_LOCATION_TIMEOUT_MS);
    }

    // ── LocationListener ─────────────────────────────────────────────────────

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
