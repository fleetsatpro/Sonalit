package com.fleetops.guardian;

import android.app.Activity;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;
import com.fleetops.guardian.R;

public class LockScreenActivity extends Activity {
    private boolean lostMode = false;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );

        setContentView(R.layout.activity_lock_screen);

        String message = getIntent().getStringExtra("message");
        lostMode       = getIntent().getBooleanExtra("lost_mode", false);

        TextView tvMsg = (TextView) findViewById(R.id.tvLockMessage);
        Button   btnOk = (Button)   findViewById(R.id.btnLockDismiss);

        if (message != null) tvMsg.setText(message);

        if (lostMode) {
            btnOk.setVisibility(View.GONE);
        } else {
            btnOk.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { finish(); }
            });
        }
    }

    @Override
    public void onBackPressed() {
        // Block back key
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // Block home and recents
        if (keyCode == KeyEvent.KEYCODE_HOME || keyCode == KeyEvent.KEYCODE_APP_SWITCH) {
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
