package com.sonalit.pegagent.ui;

import android.Manifest;
import android.app.admin.DevicePolicyManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
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

import com.sonalit.pegagent.PegAgentApp;
import com.sonalit.pegagent.R;
import com.sonalit.pegagent.services.PegDeviceAdminReceiver;
import com.sonalit.pegagent.util.PegConfig;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends AppCompatActivity {

    private static final int PERM_REQ = 100;

    private TextView tvStatus, tvBadge, tvOrgId, tvDeviceId, tvAdminStatus, tvLog;
    private Button btnSos, btnMdm;
    private LinearLayout enrollLayout;
    private StringBuilder logBuffer = new StringBuilder();

    private final ActivityResultLauncher<Intent> qrLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (result.getResultCode() == RESULT_OK) {
                    refreshStatus();
                    ((PegAgentApp) getApplication()).startCommandService();
                    appendLog("✓ QR enrollment complete — service started");
                }
            });

    private final ActivityResultLauncher<Intent> adminLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (PegDeviceAdminReceiver.isAdminActive(this)) {
                    appendLog("✓ Device Admin: Active");
                    tvAdminStatus.setText("MDM: Active");
                    tvAdminStatus.setTextColor(Color.parseColor("#22c55e"));
                    if (btnMdm != null) btnMdm.setVisibility(View.GONE);
                } else {
                    appendLog("✗ Device Admin: Not granted");
                }
            });

    private final BroadcastReceiver forceCheckinReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            runOnUiThread(() -> {
                appendLog("⚡ Force check-in requested by operator");
                tvLog.setTextColor(Color.parseColor("#f59e0b"));
            });
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            buildUI();
            refreshStatus();

            try {
                androidx.core.content.ContextCompat.registerReceiver(this, forceCheckinReceiver,
                        new IntentFilter("com.sonalit.pegagent.ACTION_FORCE_CHECKIN"),
                        androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED);
            } catch (Throwable t) {
                timber.log.Timber.e(t, "registerReceiver failed");
            }

            appendLog("Agent initializing...");
            if (PegConfig.isEnrolled(this)) {
                appendLog("✓ Enrollment: Active");
                appendLog(PegDeviceAdminReceiver.isAdminActive(this)
                        ? "✓ Device Admin: Active" : "! Device Admin: Not enabled");
            }

            // Defer permission requests until after first layout pass
            if (tvLog != null) {
                tvLog.post(this::requestCriticalPermissions);
            }
        } catch (Throwable t) {
            timber.log.Timber.e(t, "MainActivity.onCreate crashed");
            // Last resort: show a plain error view so the app doesn't silently die
            android.widget.TextView fallback = new android.widget.TextView(this);
            fallback.setText("Startup error: " + t.getMessage());
            fallback.setTextColor(android.graphics.Color.RED);
            fallback.setBackgroundColor(android.graphics.Color.BLACK);
            fallback.setPadding(40, 80, 40, 40);
            setContentView(fallback);
        }
    }

    private void buildUI() {
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
        subtitle.setText("Sonalit Field Officer Agent v1.0.5");
        subtitle.setTextColor(Color.parseColor("#6b7280"));
        subtitle.setTextSize(11f);
        subtitle.setPadding(0, 4, 0, 32);
        root.addView(subtitle);

        // Status indicators
        tvStatus = makeLabel("● CONNECTING...", "#f59e0b");
        root.addView(tvStatus);

        tvBadge    = makeInfo("Badge: —");
        tvOrgId    = makeInfo("Org: —");
        tvDeviceId = makeInfo("Device: —");
        tvAdminStatus = makeInfo("MDM: Checking...");
        root.addView(tvBadge);
        root.addView(tvOrgId);
        root.addView(tvDeviceId);
        root.addView(tvAdminStatus);

        // Enable MDM button
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

        // SOS button
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

        // Enrollment section
        enrollLayout = new LinearLayout(this);
        enrollLayout.setOrientation(LinearLayout.VERTICAL);
        enrollLayout.setPadding(0, 24, 0, 0);

        TextView enrollTitle = new TextView(this);
        enrollTitle.setText("ENROLL DEVICE");
        enrollTitle.setTextColor(Color.parseColor("#F0B429"));
        enrollTitle.setTextSize(14f);
        enrollTitle.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        enrollLayout.addView(enrollTitle);

        // QR scan button
        Button btnScanQr = new Button(this);
        btnScanQr.setText("⬛ SCAN QR CODE");
        btnScanQr.setBackgroundColor(Color.parseColor("#1d4ed8"));
        btnScanQr.setTextColor(Color.WHITE);
        btnScanQr.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        btnScanQr.setPadding(0, 24, 0, 24);
        LinearLayout.LayoutParams qrParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        qrParams.setMargins(0, 12, 0, 8);
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

        // Pre-fill server URL
        EditText etServer = makeInput("Server URL");
        etServer.setText("https://api.sonalit.com");
        EditText etOrg   = makeInput("Organization ID");
        EditText etToken = makeInput("Auth Token");
        EditText etBadge = makeInput("Officer Badge (e.g. FO-012)");

        enrollLayout.addView(etServer);
        enrollLayout.addView(etOrg);
        enrollLayout.addView(etToken);
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
            String org    = etOrg.getText().toString().trim();
            String tok    = etToken.getText().toString().trim();
            String badge  = etBadge.getText().toString().trim();
            if (server.isEmpty() || org.isEmpty() || tok.isEmpty() || badge.isEmpty()) {
                appendLog("✗ All fields required");
                return;
            }
            PegConfig.saveEnrollment(server, org,
                    "device_" + System.currentTimeMillis(),
                    tok, tok, badge, "");
            appendLog("✓ Enrollment saved");
            refreshStatus();
            ((PegAgentApp) getApplication()).startCommandService();
            appendLog("✓ Agent service started");
        });
        enrollLayout.addView(btnEnroll);
        enrollLayout.setVisibility(PegConfig.isEnrolled(this) ? View.GONE : View.VISIBLE);
        root.addView(enrollLayout);

        // Log display
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
        boolean enrolled = PegConfig.isEnrolled(this);
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
        adminLauncher.launch(intent);
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
            ActivityCompat.requestPermissions(this, new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.POST_NOTIFICATIONS,
                Manifest.permission.READ_MEDIA_IMAGES
            }, PERM_REQ);
        } else {
            ActivityCompat.requestPermissions(this, new String[]{
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            }, PERM_REQ);
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
