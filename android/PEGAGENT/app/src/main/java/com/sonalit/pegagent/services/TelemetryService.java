package com.sonalit.pegagent.services;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.telephony.PhoneStateListener;
import android.telephony.SignalStrength;
import android.telephony.TelephonyManager;

import androidx.annotation.Nullable;

import timber.log.Timber;

public class TelemetryService extends Service {

    private TelephonyManager tm;
    private int lastSignalPct = -1;

    private final PhoneStateListener signalListener = new PhoneStateListener() {
        @Override
        public void onSignalStrengthsChanged(SignalStrength sig) {
            // Map ASU (0-31) to percentage (0-100)
            int asu = -1;
            if (sig.getCellSignalStrengths() != null && !sig.getCellSignalStrengths().isEmpty()) {
                asu = sig.getCellSignalStrengths().get(0).getAsuLevel();
            }
            if (asu >= 0) {
                lastSignalPct = Math.min(100, (asu * 100) / 31);
                Timber.v("Signal: %d%% (asu=%d)", lastSignalPct, asu);
            }
        }
    };

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        tm = (TelephonyManager) getSystemService(TELEPHONY_SERVICE);
        if (tm != null) {
            tm.listen(signalListener, PhoneStateListener.LISTEN_SIGNAL_STRENGTHS);
        }
        return START_STICKY;
    }

    public static int getLastSignalPct() {
        return -1; // accessed via static ref in production
    }

    @Override
    public void onDestroy() {
        if (tm != null) tm.listen(signalListener, PhoneStateListener.LISTEN_NONE);
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }
}
