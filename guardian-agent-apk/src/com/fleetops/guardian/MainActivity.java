package com.fleetops.guardian;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.*;
import android.os.*;
import android.view.View;
import android.widget.*;
import java.text.DateFormat;
import java.util.Date;
import com.fleetops.guardian.R;

public class MainActivity extends Activity {
    private TextView tvDeviceName, tvGps, tvBattery, tvStatus, tvLastSync, tvPanicMode;
    private Button btnPanic, btnReport;
    private DevicePrefs prefs;
    private Handler handler;
    private boolean panicActive = false;
    private final String[] panicModes  = {"silent","loud","medical","security","hijack"};
    private final String[] panicLabels = {"Silent SOS","Loud Alarm","Medical Emergency","Security Threat","Hijack"};
    private String selectedMode = "silent";

    private final BroadcastReceiver locationReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            double lat = intent.getDoubleExtra("lat", 0);
            double lng = intent.getDoubleExtra("lng", 0);
            float  acc = intent.getFloatExtra("accuracy", 0);
            tvGps.setText(String.format("GPS: %.5f, %.5f (±%.0fm)", lat, lng, acc));
        }
    };

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
        tvDeviceName = (TextView) findViewById(R.id.tvDeviceName);
        tvGps        = (TextView) findViewById(R.id.tvGps);
        tvBattery    = (TextView) findViewById(R.id.tvBattery);
        tvStatus     = (TextView) findViewById(R.id.tvStatus);
        tvLastSync   = (TextView) findViewById(R.id.tvLastSync);
        tvPanicMode  = (TextView) findViewById(R.id.tvPanicMode);
        btnPanic     = (Button)   findViewById(R.id.btnPanic);
        btnReport    = (Button)   findViewById(R.id.btnReport);

        handler = new Handler(Looper.getMainLooper());
        tvDeviceName.setText(prefs.getDeviceName().toUpperCase());
        tvStatus.setText("TRACKING");
        tvStatus.setTextColor(0xFF00FF88);

        startService(new Intent(this, GuardianService.class));

        btnPanic.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { triggerPanic(selectedMode); }
        });
        btnPanic.setOnLongClickListener(new View.OnLongClickListener() {
            @Override public boolean onLongClick(View v) { showModeChooser(); return true; }
        });
        btnReport.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showReportDialog(); }
        });

        startBatteryUpdater();
    }

    @Override
    protected void onResume() {
        super.onResume();
        registerReceiver(locationReceiver, new IntentFilter("com.fleetops.guardian.LOCATION"));
    }

    @Override
    protected void onPause() {
        super.onPause();
        try { unregisterReceiver(locationReceiver); } catch (Exception ignored) {}
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
        panicActive = !panicActive;
        if (panicActive) {
            btnPanic.setText("CANCEL");
            tvPanicMode.setText("SOS ACTIVE — " + mode.toUpperCase());
            tvPanicMode.setTextColor(0xFFFF3355);
        } else {
            btnPanic.setText("PANIC");
            tvPanicMode.setText("Hold to choose mode");
            tvPanicMode.setTextColor(0xFF4A7090);
        }
        final boolean active = panicActive;
        new Thread(new Runnable() {
            @Override
            public void run() {
                final boolean ok = ApiClient.sendPanic(
                    prefs.getServerUrl(), prefs.getToken(), active ? mode : "cancel");
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        tvLastSync.setText(ok
                            ? "Last sync: " + DateFormat.getTimeInstance().format(new Date())
                            : "Sync failed");
                    }
                });
            }
        }).start();
    }

    private void showReportDialog() {
        final String[] cats = {"Incident","Hazard","Vehicle Issue","Route Deviation","Other"};
        final int[] chosen = {0};
        final EditText input = new EditText(this);
        input.setHint("Description...");
        input.setTextColor(0xFFE8F4FF);
        input.setHintTextColor(0xFF4A7090);
        input.setPadding(32, 16, 32, 16);

        new AlertDialog.Builder(this)
            .setTitle("Field Report")
            .setSingleChoiceItems(cats, 0, new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface d, int w) { chosen[0] = w; }
            })
            .setView(input)
            .setPositiveButton("SEND", new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface d, int w) {
                    final String desc = input.getText().toString().trim();
                    if (desc.isEmpty()) {
                        Toast.makeText(MainActivity.this, "Add a description", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    final String cat = cats[chosen[0]];
                    new Thread(new Runnable() {
                        @Override
                        public void run() {
                            final boolean ok = ApiClient.sendReport(
                                prefs.getServerUrl(), prefs.getToken(), cat, desc);
                            runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    Toast.makeText(MainActivity.this,
                                        ok ? "Report sent" : "Report queued (offline)",
                                        Toast.LENGTH_SHORT).show();
                                }
                            });
                        }
                    }).start();
                }
            })
            .setNegativeButton("Cancel", null)
            .show();
    }

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
