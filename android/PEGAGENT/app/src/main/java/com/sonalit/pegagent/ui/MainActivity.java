package com.sonalit.pegagent.ui;

import android.Manifest;
import android.app.Activity;
import android.app.admin.DevicePolicyManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.sonalit.pegagent.PegAgentApp;
import com.sonalit.pegagent.R;
import com.sonalit.pegagent.network.PegApiClient;
import com.sonalit.pegagent.services.PegDeviceAdminReceiver;
import com.sonalit.pegagent.util.PegConfig;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends Activity {

    private static final int PERM_REQ   = 100;
    private static final int REQ_QR     = 200;
    private static final int REQ_ADMIN  = 201;

    private TextView tvStatus, tvBadge, tvOrgId, tvDeviceId, tvAdminStatus, tvLog;
    private Button btnSos, btnMdm;
    private LinearLayout enrollLayout;
    private final StringBuilder logBuffer = new StringBuilder();

    // Read crash log before super.onCreate() (which may crash) using app context.
    private String pendingCrashLog;

    private final BroadcastReceiver forceCheckinReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            runOnUiThread(() -> {
                appendLog("⚡ Force check-in requested by operator");
                if (tvLog != null) tvLog.setTextColor(Color.parseColor("#f59e0b"));
            });
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Read (and clear) any saved crash BEFORE super.onCreate() which could itself crash.
        try {
            SharedPreferences cp = getApplicationContext()
                    .getSharedPreferences(PegAgentApp.PREFS_CRASH, MODE_PRIVATE);
            pendingCrashLog = cp.getString(PegAgentApp.KEY_CRASH, null);
            if (pendingCrashLog != null) cp.edit().remove(PegAgentApp.KEY_CRASH).apply();
        } catch (Throwable ignored) {}

        super.onCreate(savedInstanceState);

        try {
            buildUI();
            refreshStatus();

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    registerReceiver(forceCheckinReceiver,
                            new IntentFilter("com.sonalit.pegagent.ACTION_FORCE_CHECKIN"),
                            RECEIVER_NOT_EXPORTED);
                } else {
                    registerReceiver(forceCheckinReceiver,
                            new IntentFilter("com.sonalit.pegagent.ACTION_FORCE_CHECKIN"));
                }
            } catch (Throwable t) {
                timber.log.Timber.e(t, "registerReceiver failed");
            }

            // Show crash from previous session
            if (pendingCrashLog != null) {
                String snippet = pendingCrashLog.length() > 600
                        ? pendingCrashLog.substring(0, 600) + "…" : pendingCrashLog;
                appendLog("!! PREV CRASH:\n" + snippet);
                if (tvLog != null) tvLog.setTextColor(Color.parseColor("#ef4444"));
            }

            appendLog("Agent initializing...");
            if (PegConfig.isEnrolled(this)) {
                appendLog("✓ Enrollment: Active");
                appendLog(PegDeviceAdminReceiver.isAdminActive(this)
                        ? "✓ Device Admin: Active" : "! Device Admin: Not enabled");
            }

            if (tvLog != null) {
                tvLog.post(this::requestCriticalPermissions);
            }
        } catch (Throwable t) {
            timber.log.Timber.e(t, "MainActivity.onCreate crashed");
            android.widget.TextView fallback = new android.widget.TextView(this);
            fallback.setText("Startup error: " + t.getMessage());
            fallback.setTextColor(android.graphics.Color.RED);
            fallback.setBackgroundColor(android.graphics.Color.BLACK);
            fallback.setPadding(40, 80, 40, 40);
            setContentView(fallback);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_QR && resultCode == RESULT_OK) {
            refreshStatus();
            ((PegAgentApp) getApplication()).startCommandService();
            appendLog("✓ QR enrollment complete — service started");
        } else if (requestCode == REQ_ADMIN) {
            if (PegDeviceAdminReceiver.isAdminActive(this)) {
                appendLog("✓ Device Admin: Active");
                if (tvAdminStatus != null) {
                    tvAdminStatus.setText("MDM: Active");
                    tvAdminStatus.setTextColor(Color.parseColor("#22c55e"));
                }
                if (btnMdm != null) btnMdm.setVisibility(View.GONE);
            } else {
                appendLog("✗ Device Admin: Not granted");
            }
        }
    }

    private void buildUI() {
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.parseColor("#04080F"));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(40, 60, 40, 40);

        TextView title = new TextView(this);
        title.setText("PEGAGENT");
        title.setTextColor(Color.parseColor("#F0B429"));
        title.setTextSize(32f);
        title.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        title.setLetterSpacing(0.12f);
        root.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText("Sonalit Field Officer Agent v1.0.12");
        subtitle.setTextColor(Color.parseColor("#6b7280"));
        subtitle.setTextSize(11f);
        subtitle.setPadding(0, 4, 0, 32);
        root.addView(subtitle);

        tvStatus = makeLabel("● CONNECTING...", "#f59e0b");
        root.addView(tvStatus);

        tvBadge       = makeInfo("Badge: —");
        tvOrgId       = makeInfo("Org: —");
        tvDeviceId    = makeInfo("Device: —");
        tvAdminStatus = makeInfo("MDM: Checking...");
        root.addView(tvBadge);
        root.addView(tvOrgId);
        root.addView(tvDeviceId);
        root.addView(tvAdminStatus);

        btnMdm = new Button(this);
        btnMdm.setText("ENABLE DEVICE ADMIN (MDM)");
        btnMdm.setBackgroundColor(Color.parseColor("#1d4ed8"));
        btnMdm.setTextColor(Color.WHITE);
        btnMdm.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        btnMdm.setPadding(0, 24, 0, 24);
        LinearLayout.LayoutParams mdmParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        mdmParams.setMargins(0, 16, 0, 8);
        btnMdm.setLayoutParams(mdmParams);
        btnMdm.setOnClickListener(v -> launchDeviceAdminRequest());
        root.addView(btnMdm);

        btnSos = new Button(this);
        btnSos.setText("⚠ SOS EMERGENCY");
        btnSos.setBackgroundColor(Color.parseColor("#ef4444"));
        btnSos.setTextColor(Color.WHITE);
        btnSos.setTextSize(16f);
        btnSos.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        btnSos.setPadding(0, 32, 0, 32);
        LinearLayout.LayoutParams sosParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        sosParams.setMargins(0, 16, 0, 16);
        btnSos.setLayoutParams(sosParams);
        btnSos.setOnClickListener(v -> triggerSos());
        root.addView(btnSos);

        enrollLayout = new LinearLayout(this);
        enrollLayout.setOrientation(LinearLayout.VERTICAL);
        enrollLayout.setPadding(0, 24, 0, 0);

        TextView enrollTitle = new TextView(this);
        enrollTitle.setText("ENROLL DEVICE");
        enrollTitle.setTextColor(Color.parseColor("#F0B429"));
        enrollTitle.setTextSize(14f);
        enrollTitle.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        enrollLayout.addView(enrollTitle);

        EditText etServer = makeInput("Server URL");
        etServer.setText("https://api.sonalit.com");
        EditText etBadge = makeInput("Officer Badge (e.g. FO-012)");

        enrollLayout.addView(etServer);
        enrollLayout.addView(etBadge);

        Button btnEnroll = new Button(this);
        btnEnroll.setText("ENROLL");
        btnEnroll.setBackgroundColor(Color.parseColor("#F0B429"));
        btnEnroll.setTextColor(Color.parseColor("#04080F"));
        btnEnroll.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        btnEnroll.setPadding(0, 24, 0, 24);
        LinearLayout.LayoutParams enrollBtnParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        enrollBtnParams.setMargins(0, 8, 0, 0);
        btnEnroll.setLayoutParams(enrollBtnParams);
        btnEnroll.setOnClickListener(v -> {
            String server = etServer.getText().toString().trim();
            String badge  = etBadge.getText().toString().trim();
            if (server.isEmpty() || badge.isEmpty()) {
                appendLog("✗ Server URL and Badge are required");
                return;
            }
            btnEnroll.setEnabled(false);
            btnEnroll.setText("ENROLLING...");
            appendLog("Connecting to " + server + "...");
            String androidId = Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);
            PegApiClient tmpApi = new PegApiClient(this);
            tmpApi.enroll(server, badge, androidId, new PegApiClient.EnrollCallback() {
                @Override public void onSuccess(String deviceToken, String deviceUuid) {
                    runOnUiThread(() -> {
                        PegConfig.saveEnrollment(server, "", deviceUuid, deviceToken, deviceToken, badge, "");
                        appendLog("✓ Enrolled — awaiting admin approval");
                        appendLog("✓ Agent service starting...");
                        refreshStatus();
                        ((PegAgentApp) getApplication()).startCommandService();
                        btnEnroll.setEnabled(true);
                        btnEnroll.setText("ENROLL");
                    });
                }
                @Override public void onFailure(String error) {
                    runOnUiThread(() -> {
                        appendLog("✗ Enrollment failed: " + error);
                        btnEnroll.setEnabled(true);
                        btnEnroll.setText("ENROLL");
                    });
                }
            });
        });
        enrollLayout.addView(btnEnroll);
        enrollLayout.setVisibility(PegConfig.isEnrolled(this) ? View.GONE : View.VISIBLE);
        root.addView(enrollLayout);

        tvLog = new TextView(this);
        tvLog.setTextColor(Color.parseColor("#4b5563"));
        tvLog.setTextSize(10f);
        tvLog.setTypeface(android.graphics.Typeface.MONOSPACE);
        LinearLayout.LayoutParams logParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        logParams.setMargins(0, 32, 0, 0);
        tvLog.setLayoutParams(logParams);
        root.addView(tvLog);

        scroll.addView(root);
        setContentView(scroll);
    }

    private void refreshStatus() {
        boolean enrolled    = PegConfig.isEnrolled(this);
        boolean adminActive = PegDeviceAdminReceiver.isAdminActive(this);

        if (enrolled) {
            tvStatus.setText("● AGENT ACTIVE");
            tvStatus.setTextColor(Color.parseColor("#22c55e"));
            tvBadge.setText("Badge: " + PegConfig.getOfficerBadge(this));
            tvOrgId.setText("Org: " + PegConfig.getOrgId(this));
            tvDeviceId.setText("Device: " + PegConfig.getDeviceId(this));
            if (enrollLayout != null) enrollLayout.setVisibility(View.GONE);
        } else {
            tvStatus.setText("● NOT ENROLLED");
            tvStatus.setTextColor(Color.parseColor("#ef4444"));
            tvBadge.setText("Badge: —");
            tvOrgId.setText("Org: —");
            tvDeviceId.setText("Device: —");
            if (enrollLayout != null) enrollLayout.setVisibility(View.VISIBLE);
        }

        if (adminActive) {
            tvAdminStatus.setText("MDM: Active");
            tvAdminStatus.setTextColor(Color.parseColor("#22c55e"));
            if (btnMdm != null) btnMdm.setVisibility(View.GONE);
        } else {
            tvAdminStatus.setText("MDM: Not enabled");
            tvAdminStatus.setTextColor(Color.parseColor("#f59e0b"));
            if (btnMdm != null) btnMdm.setVisibility(View.VISIBLE);
        }
    }

    private void launchDeviceAdminRequest() {
        Intent intent = new Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN);
        intent.putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN,
                PegDeviceAdminReceiver.getComponentName(this));
        intent.putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                "PEGAGENT requires device admin to enforce security policies and respond to commands.");
        appendLog("Requesting Device Admin permission...");
        startActivityForResult(intent, REQ_ADMIN);
    }

    private void triggerSos() {
        Intent broadcast = new Intent("com.sonalit.pegagent.ACTION_SOS");
        broadcast.putExtra("source", "manual_button");
        sendBroadcast(broadcast);
        btnSos.setText("⚠ SOS SENT — TAP TO CANCEL");
        btnSos.setBackgroundColor(Color.parseColor("#991b1b"));
        appendLog("⚠ SOS triggered manually");
    }

    private void appendLog(String message) {
        String ts = new SimpleDateFormat("HH:mm:ss", Locale.US).format(new Date());
        if (logBuffer.length() > 0) logBuffer.append("\n");
        logBuffer.append(ts).append(" ").append(message);
        if (tvLog != null) {
            tvLog.setText(logBuffer.toString());
            tvLog.setTextColor(Color.parseColor("#4b5563"));
        }
    }

    private TextView makeLabel(String text, String color) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextColor(Color.parseColor(color));
        tv.setTextSize(14f);
        tv.setTypeface(android.graphics.Typeface.MONOSPACE);
        tv.setPadding(0, 0, 0, 8);
        return tv;
    }

    private TextView makeInfo(String text) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextColor(Color.parseColor("#6b7280"));
        tv.setTextSize(10f);
        tv.setTypeface(android.graphics.Typeface.MONOSPACE);
        tv.setPadding(0, 2, 0, 2);
        return tv;
    }

    private EditText makeInput(String hint) {
        EditText et = new EditText(this);
        et.setHint(hint);
        et.setHintTextColor(Color.parseColor("#4b5563"));
        et.setTextColor(Color.parseColor("#cbd5e1"));
        et.setBackgroundColor(Color.parseColor("#111827"));
        et.setPadding(20, 20, 20, 20);
        et.setTextSize(12f);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, 8, 0, 8);
        et.setLayoutParams(lp);
        return et;
    }

    private void requestCriticalPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissions(new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.POST_NOTIFICATIONS,
                Manifest.permission.READ_MEDIA_IMAGES
            }, PERM_REQ);
        } else {
            requestPermissions(new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            }, PERM_REQ);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            requestPermissions(
                    new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, PERM_REQ + 1);
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        try { unregisterReceiver(forceCheckinReceiver); } catch (Exception ignored) {}
    }
}
