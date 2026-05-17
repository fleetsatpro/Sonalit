package com.fleetops.guardian;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.CountDownTimer;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;
import com.fleetops.guardian.R;

public class LockScreenActivity extends Activity {
    private static final String PREFS_LOCKOUT = "guardian_lockout";
    private static final String KEY_FAILED    = "lock_failed_attempts";
    private static final String KEY_LOCKOUT_UNTIL = "lock_lockout_until";

    private boolean    lostMode  = false;
    private DevicePrefs prefs;

    private EditText  etPin;
    private Button    btnSubmit;
    private TextView  tvLockMessage, tvCountdown, tvPinHint;

    private CountDownTimer countdownTimer;

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
        prefs = new DevicePrefs(this);

        String message = getIntent().getStringExtra("message");
        lostMode       = getIntent().getBooleanExtra("lost_mode", false);

        tvLockMessage = (TextView) findViewById(R.id.tvLockMessage);
        tvCountdown   = (TextView) findViewById(R.id.tvCountdown);
        tvPinHint     = (TextView) findViewById(R.id.tvPinHint);
        etPin         = (EditText) findViewById(R.id.etPin);
        btnSubmit     = (Button)   findViewById(R.id.btnLockDismiss);

        if (message != null) tvLockMessage.setText(message);

        if (lostMode) {
            // In lost mode: hide dismiss/PIN completely
            if (btnSubmit != null) btnSubmit.setVisibility(View.GONE);
            if (etPin != null)     etPin.setVisibility(View.GONE);
            if (tvPinHint != null) tvPinHint.setVisibility(View.GONE);
            if (tvCountdown != null) tvCountdown.setVisibility(View.GONE);
            return;
        }

        // PIN-protected dismiss
        String storedPin = prefs.getPanicPin();
        boolean hasPinConfigured = storedPin != null && storedPin.length() >= 6;

        if (!hasPinConfigured) {
            // No PIN set — allow simple dismiss
            btnSubmit.setText("DISMISS");
            btnSubmit.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { finish(); }
            });
            if (etPin != null)     etPin.setVisibility(View.GONE);
            if (tvPinHint != null) tvPinHint.setVisibility(View.GONE);
            if (tvCountdown != null) tvCountdown.setVisibility(View.GONE);
        } else {
            // PIN required
            btnSubmit.setText("UNLOCK");
            if (etPin != null)     etPin.setVisibility(View.VISIBLE);
            if (tvPinHint != null) tvPinHint.setVisibility(View.VISIBLE);
            if (tvCountdown != null) tvCountdown.setVisibility(View.GONE);
            checkLockoutState();
            btnSubmit.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { attemptUnlock(); }
            });
        }
    }

    private SharedPreferences getLockoutPrefs() {
        return getSharedPreferences(PREFS_LOCKOUT, MODE_PRIVATE);
    }

    private int getFailedAttempts() {
        return getLockoutPrefs().getInt(KEY_FAILED, 0);
    }

    private long getLockoutUntil() {
        return getLockoutPrefs().getLong(KEY_LOCKOUT_UNTIL, 0L);
    }

    private void setFailedAttempts(int n) {
        getLockoutPrefs().edit().putInt(KEY_FAILED, n).apply();
    }

    private void setLockoutUntil(long millis) {
        getLockoutPrefs().edit().putLong(KEY_LOCKOUT_UNTIL, millis).apply();
    }

    private void resetLockout() {
        getLockoutPrefs().edit()
            .putInt(KEY_FAILED, 0)
            .putLong(KEY_LOCKOUT_UNTIL, 0L)
            .apply();
    }

    /**
     * Returns lockout duration in ms based on failed attempt count.
     * 3 attempts  -> 30s
     * 6 attempts  -> 5 min
     * 9 attempts  -> 30 min
     * 12 attempts -> device restart required (return -1)
     */
    private long lockoutDurationMs(int attempts) {
        if (attempts >= 12) return -1L;
        if (attempts >= 9)  return 30 * 60 * 1000L;
        if (attempts >= 6)  return  5 * 60 * 1000L;
        if (attempts >= 3)  return      30 * 1000L;
        return 0L;
    }

    private void checkLockoutState() {
        long lockoutUntil = getLockoutUntil();
        int  failed       = getFailedAttempts();

        if (failed >= 12) {
            showRestartRequired();
            return;
        }

        long now = System.currentTimeMillis();
        if (lockoutUntil > now) {
            startCountdown(lockoutUntil - now);
        }
    }

    private void attemptUnlock() {
        long lockoutUntil = getLockoutUntil();
        int  failed       = getFailedAttempts();

        if (failed >= 12) {
            showRestartRequired();
            return;
        }

        long now = System.currentTimeMillis();
        if (lockoutUntil > now) {
            // Still locked out
            return;
        }

        if (etPin == null) return;
        String entered = etPin.getText().toString().trim();

        if (entered.length() < 6) {
            Toast.makeText(this, "PIN must be at least 6 digits", Toast.LENGTH_SHORT).show();
            return;
        }

        String storedPin = prefs.getPanicPin();
        if (entered.equals(storedPin)) {
            // Correct PIN
            resetLockout();
            if (countdownTimer != null) countdownTimer.cancel();
            finish();
        } else {
            // Wrong PIN
            int newFailed = failed + 1;
            setFailedAttempts(newFailed);

            long duration = lockoutDurationMs(newFailed);
            if (duration == -1L) {
                showRestartRequired();
                return;
            }

            if (duration > 0) {
                long until = System.currentTimeMillis() + duration;
                setLockoutUntil(until);
                startCountdown(duration);
            }

            String msg = "Incorrect PIN";
            if (newFailed >= 3) {
                int remaining = 12 - newFailed;
                msg += " (" + remaining + " attempts before device restart required)";
            }
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
            etPin.setText("");
        }
    }

    private void showRestartRequired() {
        setLockoutUI(false);
        if (tvCountdown != null) {
            tvCountdown.setVisibility(View.VISIBLE);
            tvCountdown.setText("Too many failed attempts.\nDevice restart required to unlock.");
        }
        if (btnSubmit != null) btnSubmit.setEnabled(false);
        if (etPin != null)     etPin.setEnabled(false);
    }

    private void startCountdown(long durationMs) {
        setLockoutUI(true);
        if (tvCountdown != null) tvCountdown.setVisibility(View.VISIBLE);
        if (btnSubmit != null)   btnSubmit.setEnabled(false);
        if (etPin != null)       etPin.setEnabled(false);

        if (countdownTimer != null) countdownTimer.cancel();
        countdownTimer = new CountDownTimer(durationMs, 1000L) {
            @Override
            public void onTick(long millisUntilFinished) {
                if (tvCountdown == null) return;
                long secs = millisUntilFinished / 1000;
                long mins = secs / 60;
                secs = secs % 60;
                tvCountdown.setText(String.format("Locked for %d:%02d", mins, secs));
            }
            @Override
            public void onFinish() {
                if (tvCountdown != null) {
                    tvCountdown.setVisibility(View.GONE);
                }
                if (btnSubmit != null) btnSubmit.setEnabled(true);
                if (etPin != null)     etPin.setEnabled(true);
            }
        };
        countdownTimer.start();
    }

    private void setLockoutUI(boolean locked) {
        // Controls visibility during lockout (countdown shown, pin usable after)
    }

    @Override
    protected void onDestroy() {
        if (countdownTimer != null) countdownTimer.cancel();
        super.onDestroy();
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
