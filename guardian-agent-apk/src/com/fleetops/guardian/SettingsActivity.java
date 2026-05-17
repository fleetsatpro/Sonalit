package com.fleetops.guardian;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.DialogInterface;
import android.os.Bundle;
import android.view.View;
import android.widget.*;
import com.fleetops.guardian.R;

public class SettingsActivity extends Activity {
    private DevicePrefs prefs;
    private Switch      swDms;
    private Spinner     spinDmsInterval;
    private TextView    tvDmsPin, tvConvoyCode, tvAdminStatus;
    private Button      btnChangePin, btnConvoyJoin, btnConvoyLeave, btnActivateAdmin;

    private static final int[] DMS_INTERVALS_MIN = {5, 10, 15, 30, 60};
    private static final String[] DMS_LABELS =
        {"5 minutes", "10 minutes", "15 minutes", "30 minutes", "1 hour"};

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = new DevicePrefs(this);
        setContentView(R.layout.activity_settings);

        swDms           = (Switch)   findViewById(R.id.swDms);
        spinDmsInterval = (Spinner)  findViewById(R.id.spinDmsInterval);
        tvDmsPin        = (TextView) findViewById(R.id.tvDmsPin);
        tvConvoyCode    = (TextView) findViewById(R.id.tvConvoyCode);
        tvAdminStatus   = (TextView) findViewById(R.id.tvAdminStatus);
        btnChangePin    = (Button)   findViewById(R.id.btnChangePin);
        btnConvoyJoin   = (Button)   findViewById(R.id.btnConvoyJoin);
        btnConvoyLeave  = (Button)   findViewById(R.id.btnConvoyLeave);
        btnActivateAdmin= (Button)   findViewById(R.id.btnActivateAdmin);

        // DMS switch
        swDms.setChecked(prefs.isDmsEnabled());
        swDms.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override public void onCheckedChanged(CompoundButton b, boolean checked) {
                prefs.setDmsEnabled(checked);
            }
        });

        // DMS interval spinner
        ArrayAdapter<String> adapter = new ArrayAdapter<>(
            this, android.R.layout.simple_spinner_item, DMS_LABELS);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinDmsInterval.setAdapter(adapter);
        int currentInterval = prefs.getDmsIntervalMinutes();
        for (int i = 0; i < DMS_INTERVALS_MIN.length; i++) {
            if (DMS_INTERVALS_MIN[i] == currentInterval) {
                spinDmsInterval.setSelection(i);
                break;
            }
        }
        spinDmsInterval.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(AdapterView<?> p, View v, int pos, long id) {
                prefs.setDmsIntervalMinutes(DMS_INTERVALS_MIN[pos]);
            }
            @Override public void onNothingSelected(AdapterView<?> p) {}
        });

        refreshPinDisplay();
        btnChangePin.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showChangePinDialog(); }
        });

        refreshConvoyDisplay();
        btnConvoyJoin.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showConvoyJoinDialog(); }
        });
        btnConvoyLeave.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                prefs.setConvoyCode(null);
                refreshConvoyDisplay();
                Toast.makeText(SettingsActivity.this, "Left convoy", Toast.LENGTH_SHORT).show();
                final String url   = prefs.getServerUrl();
                final String token = prefs.getToken();
                new Thread(new Runnable() {
                    @Override public void run() { ApiClient.leaveConvoy(url, token); }
                }).start();
            }
        });

        refreshAdminStatus();
        btnActivateAdmin.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { requestDeviceAdmin(); }
        });
    }

    // ── PIN ───────────────────────────────────────────────────────────────────

    private void refreshPinDisplay() {
        String pin = prefs.getPanicPin();
        tvDmsPin.setText(pin.isEmpty() ? "No PIN set" : "****  (active)");
    }

    private void showChangePinDialog() {
        final EditText et = new EditText(this);
        et.setHint("4-digit PIN");
        et.setInputType(android.text.InputType.TYPE_CLASS_NUMBER |
            android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        et.setTextColor(0xFFE8F4FF);
        et.setHintTextColor(0xFF4A7090);
        et.setPadding(32, 16, 32, 16);

        new AlertDialog.Builder(this)
            .setTitle("Set Panic Cancel PIN")
            .setMessage("Enter a 4-digit PIN required to cancel an active SOS.")
            .setView(et)
            .setPositiveButton("SET", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface d, int w) {
                    String pin = et.getText().toString().trim();
                    if (pin.length() == 4 && pin.matches("\\d{4}")) {
                        prefs.setPanicPin(pin);
                        refreshPinDisplay();
                        Toast.makeText(SettingsActivity.this, "PIN updated",
                            Toast.LENGTH_SHORT).show();
                    } else {
                        Toast.makeText(SettingsActivity.this,
                            "PIN must be exactly 4 digits", Toast.LENGTH_SHORT).show();
                    }
                }
            })
            .setNeutralButton("Clear PIN", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface d, int w) {
                    prefs.setPanicPin("");
                    refreshPinDisplay();
                }
            })
            .setNegativeButton("Cancel", null)
            .show();
    }

    // ── Convoy ────────────────────────────────────────────────────────────────

    private void refreshConvoyDisplay() {
        String code = prefs.getConvoyCode();
        tvConvoyCode.setText(code != null ? code : "Not in a convoy");
        btnConvoyLeave.setVisibility(code != null ? View.VISIBLE : View.GONE);
    }

    private void showConvoyJoinDialog() {
        final EditText et = new EditText(this);
        et.setHint("Convoy code (e.g. CONVOY-01)");
        et.setTextColor(0xFFE8F4FF);
        et.setHintTextColor(0xFF4A7090);
        et.setPadding(32, 16, 32, 16);
        String existing = prefs.getConvoyCode();
        if (existing != null) et.setText(existing);

        new AlertDialog.Builder(this)
            .setTitle("Join Convoy")
            .setMessage("Enter the convoy code from your fleet manager.")
            .setView(et)
            .setPositiveButton("JOIN", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface d, int w) {
                    final String code = et.getText().toString().trim().toUpperCase();
                    if (code.length() >= 2) {
                        prefs.setConvoyCode(code);
                        refreshConvoyDisplay();
                        final String url   = prefs.getServerUrl();
                        final String token = prefs.getToken();
                        new Thread(new Runnable() {
                            @Override public void run() {
                                ApiClient.joinConvoy(url, token, code);
                            }
                        }).start();
                        Toast.makeText(SettingsActivity.this, "Joined " + code,
                            Toast.LENGTH_SHORT).show();
                    } else {
                        Toast.makeText(SettingsActivity.this,
                            "Enter a valid convoy code", Toast.LENGTH_SHORT).show();
                    }
                }
            })
            .setNegativeButton("Cancel", null)
            .show();
    }

    // ── Device admin ──────────────────────────────────────────────────────────

    private void refreshAdminStatus() {
        DevicePolicyManager dpm =
            (DevicePolicyManager) getSystemService(DEVICE_POLICY_SERVICE);
        ComponentName admin = new ComponentName(this, GuardianAdminReceiver.class);
        boolean active = dpm != null && dpm.isAdminActive(admin);

        tvAdminStatus.setText(active ? "ACTIVE — device protected" : "NOT ACTIVE — tap to enable");
        tvAdminStatus.setTextColor(active ? 0xFF00FF88 : 0xFFFF3355);
        btnActivateAdmin.setVisibility(active ? View.GONE : View.VISIBLE);
    }

    private void requestDeviceAdmin() {
        DevicePolicyManager dpm =
            (DevicePolicyManager) getSystemService(DEVICE_POLICY_SERVICE);
        ComponentName admin = new ComponentName(this, GuardianAdminReceiver.class);
        if (dpm != null && !dpm.isAdminActive(admin)) {
            android.content.Intent intent =
                new android.content.Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN);
            intent.putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, admin);
            intent.putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                "Required to protect this device from unauthorized removal.");
            startActivityForResult(intent, 200);
        }
    }

    @Override
    protected void onActivityResult(int req, int res, android.content.Intent data) {
        if (req == 200) refreshAdminStatus();
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshAdminStatus();
    }
}
