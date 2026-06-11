package com.sonalit.pegagent.ui;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;

import com.sonalit.pegagent.R;
import com.sonalit.pegagent.util.PegConfig;

public class MainActivity extends AppCompatActivity {

    private static final int PERM_REQ = 100;

    private TextView tvStatus, tvBadge, tvOrgId, tvDeviceId, tvLog;
    private Button btnSos, btnEnroll;
    private LinearLayout enrollLayout, mainLayout;

    private final ActivityResultLauncher<Intent> qrLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (result.getResultCode() == RESULT_OK) {
                    refreshStatus();
                    restartCommandService();
                }
            });

    private final BroadcastReceiver forceCheckinReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            runOnUiThread(() -> showCheckinDialog());
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Build UI programmatically - no XML dependency issues
        buildUI();

        // Request permissions
        requestCriticalPermissions();

        // Update display
        refreshStatus();

        // Register force-checkin receiver
        registerReceiver(forceCheckinReceiver,
                new IntentFilter("com.sonalit.pegagent.ACTION_FORCE_CHECKIN"),
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                        ? Context.RECEIVER_NOT_EXPORTED : 0);
    }

    private void buildUI() {
        // Root scroll
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.parseColor("#04080F"));

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(40, 60, 40, 40);

        // Title
        TextView title = new TextView(this);
        title.setText("PEGAGENT");
        title.setTextColor(Color.parseColor("#F0B429"));
        title.setTextSize(32f);
        title.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        title.setLetterSpacing(0.12f);
        root.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText("Sonalit Field Officer Agent v1.0");
        subtitle.setTextColor(Color.parseColor("#6b7280"));
        subtitle.setTextSize(11f);
        subtitle.setPadding(0, 4, 0, 32);
        root.addView(subtitle);

        // Status section
        tvStatus = makeLabel("● CONNECTING...", "#f59e0b");
        root.addView(tvStatus);

        tvBadge    = makeInfo("Badge: —");
        tvOrgId    = makeInfo("Org: —");
        tvDeviceId = makeInfo("Device: —");
        root.addView(tvBadge);
        root.addView(tvOrgId);
        root.addView(tvDeviceId);

        // SOS Button
        btnSos = new Button(this);
        btnSos.setText("⚠ SOS EMERGENCY");
        btnSos.setBackgroundColor(Color.parseColor("#ef4444"));
        btnSos.setTextColor(Color.WHITE);
        btnSos.setTextSize(16f);
        btnSos.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        btnSos.setPadding(0, 32, 0, 32);
        LinearLayout.LayoutParams sosParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        sosParams.setMargins(0, 40, 0, 16);
        btnSos.setLayoutParams(sosParams);
        btnSos.setOnClickListener(v -> triggerSos());
        root.addView(btnSos);

        // Enroll section
        enrollLayout = new LinearLayout(this);
        enrollLayout.setOrientation(LinearLayout.VERTICAL);
        enrollLayout.setPadding(0, 30, 0, 0);

        TextView enrollTitle = new TextView(this);
        enrollTitle.setText("ENROLL DEVICE");
        enrollTitle.setTextColor(Color.parseColor("#F0B429"));
        enrollTitle.setTextSize(14f);
        enrollTitle.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        enrollLayout.addView(enrollTitle);

        // QR scan button — primary enrollment path
        Button btnScanQr = new Button(this);
        btnScanQr.setText("⬛ SCAN QR CODE");
        btnScanQr.setBackgroundColor(Color.parseColor("#1d4ed8"));
        btnScanQr.setTextColor(Color.WHITE);
        btnScanQr.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        btnScanQr.setPadding(0, 24, 0, 24);
        LinearLayout.LayoutParams qrParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        qrParams.setMargins(0, 16, 0, 8);
        btnScanQr.setLayoutParams(qrParams);
        btnScanQr.setOnClickListener(v ->
                qrLauncher.launch(new Intent(this, ScanQrActivity.class)));
        enrollLayout.addView(btnScanQr);

        TextView orLabel = new TextView(this);
        orLabel.setText("— or enter manually —");
        orLabel.setTextColor(Color.parseColor("#6b7280"));
        orLabel.setTextSize(10f);
        orLabel.setPadding(0, 8, 0, 4);
        enrollLayout.addView(orLabel);

        EditText etServer = makeInput("Server URL (e.g. https://api.sonalit.com)");
        EditText etOrg    = makeInput("Organization ID");
        EditText etToken  = makeInput("Enrollment Token");
        EditText etBadge  = makeInput("Officer Badge (e.g. FO-012)");

        enrollLayout.addView(etServer);
        enrollLayout.addView(etOrg);
        enrollLayout.addView(etToken);
        enrollLayout.addView(etBadge);

        btnEnroll = new Button(this);
        btnEnroll.setText("ENROLL");
        btnEnroll.setBackgroundColor(Color.parseColor("#F0B429"));
        btnEnroll.setTextColor(Color.parseColor("#04080F"));
        btnEnroll.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        btnEnroll.setOnClickListener(v -> {
            String server = etServer.getText().toString().trim();
            String org    = etOrg.getText().toString().trim();
            String tok    = etToken.getText().toString().trim();
            String badge  = etBadge.getText().toString().trim();
            if (!server.isEmpty() && !org.isEmpty() && !tok.isEmpty() && !badge.isEmpty()) {
                // Save and restart service
                PegConfig.saveEnrollment(server, org, "device_" + System.currentTimeMillis(),
                        tok, tok, badge, "");
                refreshStatus();
                restartCommandService();
            }
        });
        enrollLayout.addView(btnEnroll);
        enrollLayout.setVisibility(PegConfig.isEnrolled(this) ? View.GONE : View.VISIBLE);
        root.addView(enrollLayout);

        // Log section
        tvLog = new TextView(this);
        tvLog.setTextColor(Color.parseColor("#4b5563"));
        tvLog.setTextSize(10f);
        tvLog.setTypeface(android.graphics.Typeface.MONOSPACE);
        tvLog.setPadding(0, 30, 0, 0);
        tvLog.setText("Waiting for commands...");
        root.addView(tvLog);

        scroll.addView(root);
        setContentView(scroll);
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

    private void refreshStatus() {
        if (PegConfig.isEnrolled(this)) {
            tvStatus.setText("● AGENT ACTIVE");
            tvStatus.setTextColor(Color.parseColor("#22c55e"));
            tvBadge.setText("Badge: " + PegConfig.getOfficerBadge(this));
            tvOrgId.setText("Org: " + PegConfig.getOrgId(this));
            tvDeviceId.setText("Device: " + PegConfig.getDeviceId(this));
            if (enrollLayout != null) enrollLayout.setVisibility(View.GONE);
        } else {
            tvStatus.setText("● NOT ENROLLED");
            tvStatus.setTextColor(Color.parseColor("#ef4444"));
            if (enrollLayout != null) enrollLayout.setVisibility(View.VISIBLE);
        }
    }

    private void triggerSos() {
        // SOS: send telemetry immediately with SOS flag
        Intent broadcast = new Intent("com.sonalit.pegagent.ACTION_SOS");
        broadcast.putExtra("source", "manual_button");
        sendBroadcast(broadcast);

        btnSos.setText("⚠ SOS SENT — TAP TO CANCEL");
        btnSos.setBackgroundColor(Color.parseColor("#991b1b"));
    }

    private void showCheckinDialog() {
        // Bring app to foreground for check-in
        tvLog.setText("⚡ Force check-in requested by operator");
        tvLog.setTextColor(Color.parseColor("#f59e0b"));
    }

    private void restartCommandService() {
        Intent svc = new Intent(this, com.sonalit.pegagent.services.PegCommandService.class);
        stopService(svc);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(svc);
        } else {
            startService(svc);
        }
    }

    private void requestCriticalPermissions() {
        String[] perms = {
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.POST_NOTIFICATIONS,
            Manifest.permission.READ_MEDIA_IMAGES
        };
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ActivityCompat.requestPermissions(this, perms, PERM_REQ);
        } else {
            String[] legacyPerms = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            };
            ActivityCompat.requestPermissions(this, legacyPerms, PERM_REQ);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, PERM_REQ + 1);
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        try { unregisterReceiver(forceCheckinReceiver); } catch (Exception ignored) {}
    }
}
