package com.sonalit.pegagent.ui;

import android.content.Intent;
import android.os.Bundle;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

/**
 * QR enrollment stub — CameraX removed to fix startup crash.
 * Use manual enrollment on the main screen instead.
 */
public class ScanQrActivity extends AppCompatActivity {

    public static final String EXTRA_RESULT = "enrollment_result";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Toast.makeText(this,
                "QR scanning unavailable — use manual enrollment on the main screen",
                Toast.LENGTH_LONG).show();
        setResult(RESULT_CANCELED);
        finish();
    }
}
