package com.fleetops.guardian;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.*;
import android.graphics.Bitmap;
import android.os.*;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.*;
import android.widget.*;
import java.io.ByteArrayOutputStream;
import java.text.DateFormat;
import java.util.Date;
import com.fleetops.guardian.R;

public class MainActivity extends Activity {
    private static final int REQ_PHOTO = 201;

    private TextView tvDeviceName, tvGps, tvBattery, tvStatus, tvLastSync;
    private TextView tvPanicMode, tvDmsCountdown, tvQueueBadge, tvMsgBadge, tvConvoyBadge;
    private Button   btnPanic, btnReport, btnCheckin, btnSettings, btnConvoy, btnMessages;
    private DevicePrefs prefs;
    private Handler  handler;
    private boolean  panicActive = false;

    private double currentLat = 0, currentLng = 0;

    // Volume SOS: track rapid volume-down presses
    private int  volumeDownCount = 0;
    private long firstVolumeDown = 0;
    private static final int  VOLUME_SOS_COUNT = 3;
    private static final long VOLUME_SOS_WINDOW_MS = 2000L;

    private final String[] panicModes  = {"silent","loud","medical","security","hijack"};
    private final String[] panicLabels = {"Silent SOS","Loud Alarm","Medical","Security Threat","Hijack"};
    private String selectedMode = "silent";

    private final String[] reportCats = {
        "Accident / Incident", "Roadblock / Hazard", "Suspicious Activity",
        "Theft", "Attack / Assault", "Medical Emergency",
        "Checkpoint", "Delivery Issue", "Vehicle Issue",
    };

    // Photo captured for current report
    private String pendingPhotoBase64 = null;

    // ── Broadcast receivers ───────────────────────────────────────────────────

    private final BroadcastReceiver locationReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            currentLat = intent.getDoubleExtra("lat", 0);
            currentLng = intent.getDoubleExtra("lng", 0);
            float acc = intent.getFloatExtra("accuracy", 0);
            float spd = intent.getFloatExtra("speed", 0);
            tvGps.setText(String.format(
                "%.5f, %.5f  ±%.0fm  %.1fkm/h",
                currentLat, currentLng, acc, spd * 3.6f));
        }
    };

    private final BroadcastReceiver statusReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            String action = intent.getAction();
            if ("com.fleetops.guardian.QUEUE_COUNT".equals(action)) {
                int count = intent.getIntExtra("count", 0);
                tvQueueBadge.setText(count > 0 ? "QUEUED: " + count : "");
                tvQueueBadge.setVisibility(count > 0 ? View.VISIBLE : View.GONE);
            } else if ("com.fleetops.guardian.MESSAGE".equals(action)) {
                prefs.incrementUnread();
                updateMessageBadge();
                showMessageBanner(
                    intent.getStringExtra("title"),
                    intent.getStringExtra("text"));
            } else if ("com.fleetops.guardian.DMS_RESET".equals(action)) {
                scheduleCountdownUpdate();
            } else if ("com.fleetops.guardian.DMS_FIRED".equals(action)) {
                tvDmsCountdown.setText("SOS SENT — check in to reset");
                tvDmsCountdown.setTextColor(0xFFFF3355);
            } else if ("com.fleetops.guardian.CRASH_DETECTED".equals(action)) {
                float mag = intent.getFloatExtra("magnitude", 0);
                Toast.makeText(MainActivity.this,
                    "CRASH DETECTED — SOS sent automatically",
                    Toast.LENGTH_LONG).show();
                panicActive = true;
                btnPanic.setText("CANCEL");
                tvPanicMode.setText("CRASH DETECTED — AUTO SOS");
                tvPanicMode.setTextColor(0xFFFF3355);
            }
        }
    };

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = new DevicePrefs(this);

        if (!prefs.isEnrolled()) {
            startActivity(new Intent(this, EnrollmentActivity.class));
            finish();
            return;
        }

        setContentView(R.layout.activity_main);

        tvDeviceName   = (TextView) findViewById(R.id.tvDeviceName);
        tvGps          = (TextView) findViewById(R.id.tvGps);
        tvBattery      = (TextView) findViewById(R.id.tvBattery);
        tvStatus       = (TextView) findViewById(R.id.tvStatus);
        tvLastSync     = (TextView) findViewById(R.id.tvLastSync);
        tvPanicMode    = (TextView) findViewById(R.id.tvPanicMode);
        tvDmsCountdown = (TextView) findViewById(R.id.tvDmsCountdown);
        tvQueueBadge   = (TextView) findViewById(R.id.tvQueueBadge);
        tvMsgBadge     = (TextView) findViewById(R.id.tvMsgBadge);
        tvConvoyBadge  = (TextView) findViewById(R.id.tvConvoyBadge);
        btnPanic       = (Button)   findViewById(R.id.btnPanic);
        btnReport      = (Button)   findViewById(R.id.btnReport);
        btnCheckin     = (Button)   findViewById(R.id.btnCheckin);
        btnSettings    = (Button)   findViewById(R.id.btnSettings);
        btnConvoy      = (Button)   findViewById(R.id.btnConvoy);
        btnMessages    = (Button)   findViewById(R.id.btnMessages);

        handler = new Handler(Looper.getMainLooper());
        tvDeviceName.setText(prefs.getDeviceName().toUpperCase());
        tvStatus.setText("TRACKING");
        tvStatus.setTextColor(0xFF00FF88);

        startService(new Intent(this, GuardianService.class));

        btnPanic.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { onPanicClick(); }
        });
        btnPanic.setOnLongClickListener(new View.OnLongClickListener() {
            @Override public boolean onLongClick(View v) { showModeChooser(); return true; }
        });
        btnReport.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showReportDialog(); }
        });
        btnCheckin.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { doCheckin(); }
        });
        btnSettings.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                startActivity(new Intent(MainActivity.this, SettingsActivity.class));
            }
        });
        btnConvoy.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showConvoyDialog(); }
        });
        btnMessages.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                prefs.clearUnread();
                updateMessageBadge();
            }
        });

        startBatteryUpdater();
        updateMessageBadge();
        updateConvoyBadge();
        if (prefs.isDmsEnabled()) scheduleCountdownUpdate();
    }

    @Override
    protected void onResume() {
        super.onResume();
        IntentFilter f = new IntentFilter();
        f.addAction("com.fleetops.guardian.LOCATION");
        registerReceiver(locationReceiver, f);

        IntentFilter sf = new IntentFilter();
        sf.addAction("com.fleetops.guardian.QUEUE_COUNT");
        sf.addAction("com.fleetops.guardian.MESSAGE");
        sf.addAction("com.fleetops.guardian.DMS_RESET");
        sf.addAction("com.fleetops.guardian.DMS_FIRED");
        sf.addAction("com.fleetops.guardian.CRASH_DETECTED");
        registerReceiver(statusReceiver, sf);
    }

    @Override
    protected void onPause() {
        super.onPause();
        try { unregisterReceiver(locationReceiver); } catch (Exception ignored) {}
        try { unregisterReceiver(statusReceiver); } catch (Exception ignored) {}
    }

    // ── Volume SOS ────────────────────────────────────────────────────────────

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_VOLUME_DOWN &&
                event.getAction() == KeyEvent.ACTION_DOWN) {
            long now = System.currentTimeMillis();
            if (volumeDownCount == 0 || now - firstVolumeDown > VOLUME_SOS_WINDOW_MS) {
                volumeDownCount = 1;
                firstVolumeDown = now;
            } else {
                volumeDownCount++;
                if (volumeDownCount >= VOLUME_SOS_COUNT) {
                    volumeDownCount = 0;
                    triggerPanic(selectedMode);
                    Toast.makeText(this, "VOLUME SOS ACTIVATED", Toast.LENGTH_SHORT).show();
                    return true;
                }
            }
        }
        return super.dispatchKeyEvent(event);
    }

    // ── Panic ─────────────────────────────────────────────────────────────────

    private void onPanicClick() {
        if (panicActive) {
            // Require PIN to cancel if one is set
            String pin = prefs.getPanicPin();
            if (!pin.isEmpty()) {
                showPinCancelDialog(pin);
            } else {
                cancelPanic();
            }
        } else {
            triggerPanic(selectedMode);
        }
    }

    private void showPinCancelDialog(final String correctPin) {
        final EditText et = new EditText(this);
        et.setHint("Enter PIN to cancel SOS");
        et.setInputType(android.text.InputType.TYPE_CLASS_NUMBER |
            android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        et.setTextColor(0xFFE8F4FF);
        et.setHintTextColor(0xFF4A7090);
        et.setPadding(32, 16, 32, 16);

        new AlertDialog.Builder(this)
            .setTitle("Cancel SOS?")
            .setMessage("Enter your cancel PIN to deactivate the SOS alert.")
            .setView(et)
            .setPositiveButton("CANCEL SOS", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface d, int w) {
                    if (et.getText().toString().equals(correctPin)) {
                        cancelPanic();
                    } else {
                        Toast.makeText(MainActivity.this,
                            "Wrong PIN — SOS remains active", Toast.LENGTH_SHORT).show();
                    }
                }
            })
            .setNegativeButton("Keep SOS Active", null)
            .show();
    }

    private void showModeChooser() {
        new AlertDialog.Builder(this)
            .setTitle("Select Panic Mode")
            .setItems(panicLabels, new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface d, int which) {
                    selectedMode = panicModes[which];
                    tvPanicMode.setText("Mode: " + panicLabels[which]);
                }
            })
            .show();
    }

    private void triggerPanic(final String mode) {
        panicActive = true;
        btnPanic.setText("CANCEL");
        tvPanicMode.setText("SOS ACTIVE — " + mode.toUpperCase());
        tvPanicMode.setTextColor(0xFFFF3355);

        final double lat = currentLat;
        final double lng = currentLng;
        new Thread(new Runnable() {
            @Override
            public void run() {
                final boolean ok =
                    ApiClient.sendPanic(prefs.getServerUrl(), prefs.getToken(), mode, lat, lng);
                if (!ok) {
                    try {
                        org.json.JSONObject body = new org.json.JSONObject();
                        body.put("mode", mode);
                        body.put("lat", lat);
                        body.put("lng", lng);
                        new OfflineQueue(MainActivity.this)
                            .enqueue("panic", body.toString());
                    } catch (Exception ignored) {}
                }
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        tvLastSync.setText(ok
                            ? "Panic sent: " + DateFormat.getTimeInstance().format(new Date())
                            : "Panic queued (offline)");
                    }
                });
            }
        }).start();
    }

    private void cancelPanic() {
        panicActive = false;
        btnPanic.setText("PANIC");
        tvPanicMode.setText("Hold to choose mode");
        tvPanicMode.setTextColor(0xFF4A7090);
    }

    // ── Field Report ──────────────────────────────────────────────────────────

    private void showReportDialog() {
        pendingPhotoBase64 = null;
        final int[] chosen = {0};
        final EditText input = new EditText(this);
        input.setHint("Description...");
        input.setTextColor(0xFFE8F4FF);
        input.setHintTextColor(0xFF4A7090);
        input.setPadding(32, 16, 32, 16);

        // Container: description + photo button
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        container.setPadding(0, 8, 0, 0);
        container.addView(input);

        final Button btnPhoto = new Button(this);
        btnPhoto.setText("ATTACH PHOTO");
        btnPhoto.setTextColor(0xFF00D4FF);
        btnPhoto.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                startActivityForResult(
                    new Intent(MediaStore.ACTION_IMAGE_CAPTURE), REQ_PHOTO);
            }
        });
        container.addView(btnPhoto);

        final TextView tvPhotoStatus = new TextView(this);
        tvPhotoStatus.setTextColor(0xFF00FF88);
        tvPhotoStatus.setTextSize(11);
        tvPhotoStatus.setPadding(16, 4, 16, 4);
        container.addView(tvPhotoStatus);

        // Store refs so onActivityResult can update them
        this.currentReportPhotoStatus = tvPhotoStatus;

        new AlertDialog.Builder(this)
            .setTitle("Field Report")
            .setSingleChoiceItems(reportCats, 0, new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface d, int w) { chosen[0] = w; }
            })
            .setView(container)
            .setPositiveButton("SEND", new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface d, int w) {
                    final String desc = input.getText().toString().trim();
                    if (desc.isEmpty()) {
                        Toast.makeText(MainActivity.this,
                            "Add a description", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    final String cat   = reportCats[chosen[0]];
                    final double lat   = currentLat;
                    final double lng   = currentLng;
                    final String photo = pendingPhotoBase64;
                    pendingPhotoBase64 = null;

                    new Thread(new Runnable() {
                        @Override
                        public void run() {
                            final boolean ok = ApiClient.sendReport(
                                prefs.getServerUrl(), prefs.getToken(),
                                cat, desc, lat, lng, photo);
                            runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    Toast.makeText(MainActivity.this,
                                        ok ? "Report sent" : "Report queued (offline)",
                                        Toast.LENGTH_SHORT).show();
                                    if (ok) tvLastSync.setText(
                                        "Synced: " + DateFormat.getTimeInstance().format(new Date()));
                                }
                            });
                        }
                    }).start();
                }
            })
            .setNegativeButton("Cancel", null)
            .show();
    }

    // Field used to update photo status from onActivityResult
    private TextView currentReportPhotoStatus;

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_PHOTO && resultCode == RESULT_OK && data != null) {
            try {
                android.os.Bundle extras = data.getExtras();
                if (extras == null) {
                    Toast.makeText(this, "Camera returned no data", Toast.LENGTH_SHORT).show();
                    return;
                }
                Object raw = extras.get("data");
                if (!(raw instanceof Bitmap)) {
                    Toast.makeText(this, "Camera returned no image", Toast.LENGTH_SHORT).show();
                    return;
                }
                Bitmap thumb = (Bitmap) raw;
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                thumb.compress(Bitmap.CompressFormat.JPEG, 75, bos);
                pendingPhotoBase64 = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
                if (currentReportPhotoStatus != null) {
                    currentReportPhotoStatus.setText("Photo attached ✓");
                }
            } catch (Exception e) {
                Toast.makeText(this, "Photo capture failed: " + e.getMessage(),
                    Toast.LENGTH_SHORT).show();
            }
        }
    }

    // ── Dead man's switch check-in ─────────────────────────────────────────────

    private void doCheckin() {
        sendBroadcast(new Intent("com.fleetops.guardian.DMS_CHECKIN"));

        final String url   = prefs.getServerUrl();
        final String token = prefs.getToken();
        new Thread(new Runnable() {
            @Override
            public void run() {
                ApiClient.checkin(url, token);
            }
        }).start();

        if (prefs.isDmsEnabled()) {
            // GuardianService handles the timer reset via broadcast
            GuardianService.dmsDeadlineMs =
                System.currentTimeMillis() + prefs.getDmsIntervalMinutes() * 60_000L;
            scheduleCountdownUpdate();
            Toast.makeText(this, "Checked in — timer reset", Toast.LENGTH_SHORT).show();
        } else {
            Toast.makeText(this, "Checked in", Toast.LENGTH_SHORT).show();
        }
    }

    private void scheduleCountdownUpdate() {
        handler.removeCallbacks(countdownUpdater);
        handler.post(countdownUpdater);
    }

    private final Runnable countdownUpdater = new Runnable() {
        @Override
        public void run() {
            long deadline = GuardianService.dmsDeadlineMs;
            if (!prefs.isDmsEnabled() || deadline == 0) {
                tvDmsCountdown.setText("DMS: off");
                tvDmsCountdown.setTextColor(0xFF4A7090);
                return;
            }
            long remaining = deadline - System.currentTimeMillis();
            if (remaining <= 0) {
                tvDmsCountdown.setText("DMS: EXPIRED");
                tvDmsCountdown.setTextColor(0xFFFF3355);
                return;
            }
            long mins = remaining / 60_000L;
            long secs = (remaining % 60_000L) / 1000L;
            tvDmsCountdown.setText(String.format("DMS: %02d:%02d", mins, secs));
            // Warning colours
            if (remaining < 60_000L) {
                tvDmsCountdown.setTextColor(0xFFFF3355);
            } else if (remaining < 5 * 60_000L) {
                tvDmsCountdown.setTextColor(0xFFFFAA00);
            } else {
                tvDmsCountdown.setTextColor(0xFF00FF88);
            }
            handler.postDelayed(this, 1000L);
        }
    };

    // ── Convoy ────────────────────────────────────────────────────────────────

    private void showConvoyDialog() {
        String currentCode = prefs.getConvoyCode();
        String msg = currentCode != null
            ? "Currently in convoy: " + currentCode + "\n\nEnter a new code to switch, or leave blank and press Leave."
            : "Enter the convoy code from your fleet manager.";

        final EditText et = new EditText(this);
        et.setHint("Convoy code");
        et.setTextColor(0xFFE8F4FF);
        et.setHintTextColor(0xFF4A7090);
        et.setPadding(32, 16, 32, 16);
        if (currentCode != null) et.setText(currentCode);

        AlertDialog.Builder b = new AlertDialog.Builder(this)
            .setTitle("Convoy")
            .setMessage(msg)
            .setView(et)
            .setPositiveButton("JOIN", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface d, int w) {
                    final String code = et.getText().toString().trim().toUpperCase();
                    if (code.length() < 2) {
                        Toast.makeText(MainActivity.this,
                            "Enter a valid convoy code", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    prefs.setConvoyCode(code);
                    updateConvoyBadge();
                    final String url   = prefs.getServerUrl();
                    final String token = prefs.getToken();
                    new Thread(new Runnable() {
                        @Override public void run() {
                            ApiClient.joinConvoy(url, token, code);
                        }
                    }).start();
                    Toast.makeText(MainActivity.this, "Joined " + code, Toast.LENGTH_SHORT).show();
                }
            })
            .setNegativeButton("Cancel", null);

        if (currentCode != null) {
            b.setNeutralButton("Leave", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface d, int w) {
                    prefs.setConvoyCode(null);
                    updateConvoyBadge();
                    final String url   = prefs.getServerUrl();
                    final String token = prefs.getToken();
                    new Thread(new Runnable() {
                        @Override public void run() {
                            ApiClient.leaveConvoy(url, token);
                        }
                    }).start();
                    Toast.makeText(MainActivity.this, "Left convoy", Toast.LENGTH_SHORT).show();
                }
            });
        }
        b.show();
    }

    private void updateConvoyBadge() {
        String code = prefs.getConvoyCode();
        if (code != null) {
            tvConvoyBadge.setText(code);
            tvConvoyBadge.setVisibility(View.VISIBLE);
        } else {
            tvConvoyBadge.setVisibility(View.GONE);
        }
    }

    // ── Messages ──────────────────────────────────────────────────────────────

    private void updateMessageBadge() {
        int n = prefs.getUnreadMessages();
        if (n > 0) {
            tvMsgBadge.setText(String.valueOf(n));
            tvMsgBadge.setVisibility(View.VISIBLE);
        } else {
            tvMsgBadge.setVisibility(View.GONE);
        }
    }

    private void showMessageBanner(String title, String text) {
        if (title == null || title.isEmpty()) title = "Fleet Message";
        Toast.makeText(this, title + ": " + text, Toast.LENGTH_LONG).show();
    }

    // ── Battery ───────────────────────────────────────────────────────────────

    private void startBatteryUpdater() {
        handler.post(new Runnable() {
            @Override
            public void run() {
                Intent bat = registerReceiver(null,
                    new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
                if (bat != null) {
                    int level = bat.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                    int scale = bat.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
                    if (level >= 0 && scale > 0) {
                        tvBattery.setText("Battery: " + (int)(100f * level / scale) + "%");
                    }
                }
                handler.postDelayed(this, 60_000L);
            }
        });
    }
}
