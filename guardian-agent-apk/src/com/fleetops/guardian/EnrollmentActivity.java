package com.fleetops.guardian;

import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.view.View;
import android.widget.*;
import org.json.JSONObject;
import com.fleetops.guardian.R;

public class EnrollmentActivity extends Activity {
    private static final int REQ_LOCATION = 101;

    private EditText   etServerUrl, etOrgToken, etDeviceName;
    private Button     btnEnroll, btnPaste;
    private ProgressBar progressBar;
    private TextView   tvStatus;
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
        btnPaste     = (Button)      findViewById(R.id.btnPaste);
        progressBar  = (ProgressBar) findViewById(R.id.progressBar);
        tvStatus     = (TextView)    findViewById(R.id.tvStatus);

        btnEnroll.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { doEnroll(); }
        });

        btnPaste.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { pasteFromClipboard(); }
        });
    }

    // Reads a JSON config string from clipboard:
    // {"url":"https://...","token":"fleet-guardian-2024","name":"Driver 1"}
    private void pasteFromClipboard() {
        ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        if (cm == null || !cm.hasPrimaryClip()) {
            status("Clipboard is empty", 0xFFFF3355);
            return;
        }
        ClipData.Item item = cm.getPrimaryClip().getItemAt(0);
        if (item == null) return;
        String text = item.getText() != null ? item.getText().toString().trim() : "";
        if (text.isEmpty()) {
            status("Clipboard is empty", 0xFFFF3355);
            return;
        }
        try {
            JSONObject json = new JSONObject(text);
            String url   = json.optString("url", "");
            String token = json.optString("token", "");
            String name  = json.optString("name", "");
            if (!url.isEmpty())   etServerUrl.setText(url);
            if (!token.isEmpty()) etOrgToken.setText(token);
            if (!name.isEmpty())  etDeviceName.setText(name);
            status("Config pasted — tap Enroll to continue", 0xFF00FF88);
        } catch (Exception e) {
            status("Clipboard doesn't contain a valid config JSON", 0xFFFF3355);
        }
    }

    private void doEnroll() {
        String url   = etServerUrl.getText().toString().trim();
        String token = etOrgToken.getText().toString().trim();
        String name  = etDeviceName.getText().toString().trim();

        if (url.isEmpty())   { status("Enter server URL", 0xFFFF3355); return; }
        if (token.isEmpty()) { status("Enter org token",  0xFFFF3355); return; }

        while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
        if (name.isEmpty()) name = android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL;
        if (name.trim().isEmpty()) name = "Guardian Device";

        final String finalUrl   = url;
        final String finalToken = token;
        final String finalName  = name;
        final String imei       = getDeviceId();

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
                            status(result.error != null ? result.error : "Enrollment failed",
                                0xFFFF3355);
                        }
                    }
                });
            }
        }).start();
    }

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
        launch();
    }

    private String getDeviceId() {
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
