package com.fleetops.guardian;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.view.View;
import android.widget.*;
import com.fleetops.guardian.R;

public class EnrollmentActivity extends Activity {
    private static final int REQ_LOCATION = 101;

    private EditText  etServerUrl, etOrgToken, etDeviceName;
    private Button    btnEnroll;
    private ProgressBar progressBar;
    private TextView  tvStatus;
    private DevicePrefs prefs;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = new DevicePrefs(this);

        if (prefs.isEnrolled()) {
            requestLocationThenLaunch();
            return;
        }

        setContentView(R.layout.activity_enrollment);
        etServerUrl  = (EditText)    findViewById(R.id.etServerUrl);
        etOrgToken   = (EditText)    findViewById(R.id.etOrgToken);
        etDeviceName = (EditText)    findViewById(R.id.etDeviceName);
        btnEnroll    = (Button)      findViewById(R.id.btnEnroll);
        progressBar  = (ProgressBar) findViewById(R.id.progressBar);
        tvStatus     = (TextView)    findViewById(R.id.tvStatus);

        btnEnroll.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) { doEnroll(); }
        });
    }

    private void doEnroll() {
        String url   = etServerUrl.getText().toString().trim();
        String token = etOrgToken.getText().toString().trim();
        String name  = etDeviceName.getText().toString().trim();

        if (url.isEmpty()) { status("Enter server URL", 0xFFFF3355); return; }
        if (token.isEmpty()) { status("Enter org token", 0xFFFF3355); return; }

        // Normalise trailing slashes
        while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        if (name.isEmpty()) name = android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL;
        if (name.trim().isEmpty()) name = "Guardian Device";

        final String finalUrl   = url;
        final String finalToken = token;
        final String finalName  = name;
        final String imei = getDeviceId();

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
                            status("Enrolled — requesting location access", 0xFF00FF88);
                            requestLocationThenLaunch();
                        } else {
                            status(result.error != null ? result.error : "Enrollment failed", 0xFFFF3355);
                        }
                    }
                });
            }
        }).start();
    }

    // Request ACCESS_FINE_LOCATION before opening the main screen.
    // Without it the GPS service throws SecurityException on Android 6+.
    private void requestLocationThenLaunch() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION)
                    != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(
                    new String[]{ android.Manifest.permission.ACCESS_FINE_LOCATION },
                    REQ_LOCATION);
                return;
            }
        }
        launch();
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] grants) {
        // Launch regardless of result — service handles SecurityException gracefully,
        // but we need at least to get to MainActivity so the user sees the UI.
        launch();
    }

    private String getDeviceId() {
        // Use Android ID as stable device identifier (no permissions needed)
        try {
            String id = android.provider.Settings.Secure.getString(
                getContentResolver(), android.provider.Settings.Secure.ANDROID_ID);
            return id != null ? id : "";
        } catch (Exception e) {
            return "";
        }
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
