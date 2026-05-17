package com.fleetops.guardian;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.os.Bundle;
import android.view.View;
import android.widget.*;
import com.fleetops.guardian.R;

public class SettingsActivity extends Activity {
    private DevicePrefs prefs;
    private Switch swDms;
    private Spinner spinDmsInterval;
    private TextView tvDmsPin, tvConvoyCode;
    private Button btnChangePin, btnConvoyJoin, btnConvoyLeave, btnUnenroll;

    private static final int[] DMS_INTERVALS_MIN = {5, 10, 15, 30, 60};
    private static final String[] DMS_LABELS =
        {"5 minutes", "10 minutes", "15 minutes", "30 minutes", "1 hour"};

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = new DevicePrefs(this);
        setContentView(R.layout.activity_settings);

        swDms          = (Switch)   findViewById(R.id.swDms);
        spinDmsInterval= (Spinner)  findViewById(R.id.spinDmsInterval);
        tvDmsPin       = (TextView) findViewById(R.id.tvDmsPin);
        tvConvoyCode   = (TextView) findViewById(R.id.tvConvoyCode);
        btnChangePin   = (Button)   findViewById(R.id.btnChangePin);
        btnConvoyJoin  = (Button)   findViewById(R.id.btnConvoyJoin);
        btnConvoyLeave = (Button)   findViewById(R.id.btnConvoyLeave);
        btnUnenroll    = (Button)   findViewById(R.id.btnUnenroll);

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

        // PIN display (masked)
        refreshPinDisplay();

        btnChangePin.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showChangePinDialog(); }
        });

        // Convoy
        refreshConvoyDisplay();
        btnConvoyJoin.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { showConvoyJoinDialog(); }
        });
        btnConvoyLeave.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                prefs.setConvoyCode(null);
                refreshConvoyDisplay();
                Toast.makeText(SettingsActivity.this, "Left convoy", Toast.LENGTH_SHORT).show();
                // Best-effort leave notification to server runs from MainActivity
            }
        });

        // Unenroll
        btnUnenroll.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { confirmUnenroll(); }
        });
    }

    private void refreshPinDisplay() {
        String pin = prefs.getPanicPin();
        tvDmsPin.setText(pin.isEmpty() ? "No PIN set" : "****  (set)");
    }

    private void refreshConvoyDisplay() {
        String code = prefs.getConvoyCode();
        tvConvoyCode.setText(code != null ? code : "Not in a convoy");
        btnConvoyLeave.setEnabled(code != null);
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
                        Toast.makeText(SettingsActivity.this, "PIN updated", Toast.LENGTH_SHORT).show();
                    } else {
                        Toast.makeText(SettingsActivity.this, "PIN must be exactly 4 digits",
                            Toast.LENGTH_SHORT).show();
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
            .setMessage("Enter the convoy code shared by your fleet manager.")
            .setView(et)
            .setPositiveButton("JOIN", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface d, int w) {
                    String code = et.getText().toString().trim().toUpperCase();
                    if (code.length() >= 2) {
                        prefs.setConvoyCode(code);
                        refreshConvoyDisplay();
                        Toast.makeText(SettingsActivity.this,
                            "Joined " + code, Toast.LENGTH_SHORT).show();
                    } else {
                        Toast.makeText(SettingsActivity.this,
                            "Enter a valid convoy code", Toast.LENGTH_SHORT).show();
                    }
                }
            })
            .setNegativeButton("Cancel", null)
            .show();
    }

    private void confirmUnenroll() {
        new AlertDialog.Builder(this)
            .setTitle("Unenroll Device")
            .setMessage("This will remove all settings and return to the enrollment screen. Are you sure?")
            .setPositiveButton("UNENROLL", new DialogInterface.OnClickListener() {
                @Override public void onClick(DialogInterface d, int w) {
                    prefs.clearEnrollment();
                    android.content.Intent i =
                        new android.content.Intent(SettingsActivity.this, EnrollmentActivity.class);
                    i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK |
                        android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK);
                    startActivity(i);
                    finish();
                }
            })
            .setNegativeButton("Cancel", null)
            .show();
    }
}
