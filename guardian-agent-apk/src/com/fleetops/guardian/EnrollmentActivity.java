package com.fleetops.guardian;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.*;
import com.fleetops.guardian.R;

public class EnrollmentActivity extends Activity {
    private EditText etServerUrl, etOrgToken, etDeviceName;
    private Button btnEnroll;
    private ProgressBar progressBar;
    private TextView tvStatus;
    private DevicePrefs prefs;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = new DevicePrefs(this);

        if (prefs.isEnrolled()) {
            launch();
            return;
        }

        setContentView(R.layout.activity_enrollment);
        etServerUrl  = (EditText)    findViewById(R.id.etServerUrl);
        etOrgToken   = (EditText)    findViewById(R.id.etOrgToken);
        etDeviceName = (EditText)    findViewById(R.id.etDeviceName);
        btnEnroll    = (Button)      findViewById(R.id.btnEnroll);
        progressBar  = (ProgressBar) findViewById(R.id.progressBar);
        tvStatus     = (TextView)    findViewById(R.id.tvStatus);

        etOrgToken.setText("fleet-guardian-2024");

        btnEnroll.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) { doEnroll(); }
        });
    }

    private void doEnroll() {
        String url   = etServerUrl.getText().toString().trim();
        String token = etOrgToken.getText().toString().trim();
        String name  = etDeviceName.getText().toString().trim();

        if (url.isEmpty()) {
            status("Please enter server URL", 0xFFFF3355);
            return;
        }
        if (token.isEmpty()) {
            status("Please enter org token", 0xFFFF3355);
            return;
        }
        if (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        if (name.isEmpty()) name = android.os.Build.MODEL;

        final String finalUrl   = url;
        final String finalToken = token;
        final String finalName  = name;
        final String imei = getImei();

        setLoading(true, "Enrolling...");

        new Thread(new Runnable() {
            @Override
            public void run() {
                final ApiClient.EnrollResult result =
                    ApiClient.enroll(finalUrl, finalToken, finalName, imei);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        setLoading(false, null);
                        if (result.token != null) {
                            prefs.saveEnrollment(finalUrl, result.token, finalName);
                            status("Enrolled successfully", 0xFF00FF88);
                            launch();
                        } else {
                            status(result.error != null ? result.error : "Enrollment failed", 0xFFFF3355);
                        }
                    }
                });
            }
        }).start();
    }

    private String getImei() {
        try {
            android.telephony.TelephonyManager tm =
                (android.telephony.TelephonyManager) getSystemService(TELEPHONY_SERVICE);
            if (tm != null) {
                String id = tm.getDeviceId();
                return id != null ? id : "";
            }
        } catch (Exception ignored) {}
        return "";
    }

    private void setLoading(boolean loading, String msg) {
        btnEnroll.setEnabled(!loading);
        progressBar.setVisibility(loading ? View.VISIBLE : View.GONE);
        if (msg != null) status(msg, 0xFF4A7090);
    }

    private void status(String msg, int color) {
        tvStatus.setText(msg);
        tvStatus.setTextColor(color);
    }

    private void launch() {
        startActivity(new Intent(this, MainActivity.class));
        finish();
    }
}
