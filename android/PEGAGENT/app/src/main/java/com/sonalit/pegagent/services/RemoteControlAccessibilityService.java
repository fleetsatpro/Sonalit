package com.sonalit.pegagent.services;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.graphics.Point;
import android.view.Display;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;

import timber.log.Timber;

/**
 * RemoteControlAccessibilityService: injects touch gestures and key events on
 * behalf of the operator during a remote session.
 *
 * Coordinates arrive in capture-space (the resolution the operator sees) and are
 * scaled to the real display before dispatch (P1-4). All ACK truthfulness flows
 * through {@link InjectionResult}: a gesture only reports success from
 * onCompleted, and callers must check {@link #isConnected()} first (P1-6).
 */
public class RemoteControlAccessibilityService extends AccessibilityService {

    private static RemoteControlAccessibilityService instance;

    public interface InjectionResult {
        void onResult(boolean success, String detail);
    }

    @Override
    protected void onServiceConnected() {
        instance = this;
        Timber.i("RemoteControlAccessibilityService connected");
    }

    @Override
    public void onInterrupt() {
        Timber.w("RemoteControlAccessibilityService interrupted");
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Not used for command injection.
    }

    @Override
    public void onDestroy() {
        instance = null;
        super.onDestroy();
    }

    public static boolean isConnected() {
        return instance != null;
    }

    private int[] realSize() {
        WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        Point size = new Point();
        try {
            Display d = wm.getDefaultDisplay();
            d.getRealSize(size);
        } catch (Exception e) {
            Timber.w(e, "getRealSize failed");
        }
        if (size.x <= 0 || size.y <= 0) { size.x = 1080; size.y = 1920; }
        return new int[]{size.x, size.y};
    }

    private float scaleX(int x, int captureW, int realW) {
        if (captureW <= 0) return x; // already real-space
        return (x / (float) captureW) * realW;
    }

    private float scaleY(int y, int captureH, int realH) {
        if (captureH <= 0) return y;
        return (y / (float) captureH) * realH;
    }

    /**
     * Inject a tap or swipe. For swipe, (x2,y2) is the end point.
     * All coordinates are capture-space; capture{W,H}==0 means real-space already.
     */
    public static void injectTouch(int x, int y, int x2, int y2, String action,
                                   int captureW, int captureH, InjectionResult cb) {
        RemoteControlAccessibilityService svc = instance;
        if (svc == null) {
            if (cb != null) cb.onResult(false, "accessibility_unavailable");
            return;
        }
        try {
            int[] real = svc.realSize();
            float sx = svc.scaleX(x, captureW, real[0]);
            float sy = svc.scaleY(y, captureH, real[1]);

            Path path = new Path();
            path.moveTo(sx, sy);

            boolean swipe = "swipe".equals(action);
            if (swipe) {
                float ex = svc.scaleX(x2, captureW, real[0]);
                float ey = svc.scaleY(y2, captureH, real[1]);
                path.lineTo(ex, ey);
            }

            long duration = swipe ? 150L : 50L;
            GestureDescription gesture = new GestureDescription.Builder()
                    .addStroke(new GestureDescription.StrokeDescription(path, 0L, duration))
                    .build();

            long startNs = System.nanoTime();
            svc.dispatchGesture(gesture, new GestureResultCallback() {
                @Override
                public void onCompleted(GestureDescription g) {
                    long ms = (System.nanoTime() - startNs) / 1_000_000;
                    Timber.d("Touch injected real=(%.0f,%.0f) action=%s in %dms", sx, sy, action, ms);
                    if (cb != null) cb.onResult(true, "executed");
                }
                @Override
                public void onCancelled(GestureDescription g) {
                    Timber.w("Touch injection cancelled");
                    if (cb != null) cb.onResult(false, "gesture_cancelled");
                }
            }, null);
        } catch (Exception e) {
            Timber.e(e, "injectTouch failed");
            if (cb != null) cb.onResult(false, e.getMessage() != null ? e.getMessage() : "inject_error");
        }
    }

    /**
     * Inject a navigation / hardware key. Navigation keys use performGlobalAction;
     * others (POWER/VOLUME) require system access and are reported unsupported
     * rather than falsely ACKed.
     */
    public static void injectKey(String key, InjectionResult cb) {
        RemoteControlAccessibilityService svc = instance;
        if (svc == null) {
            if (cb != null) cb.onResult(false, "accessibility_unavailable");
            return;
        }
        if (key == null) { if (cb != null) cb.onResult(false, "no_key"); return; }

        int globalAction;
        switch (key.toUpperCase()) {
            case "HOME":    globalAction = GLOBAL_ACTION_HOME;    break;
            case "BACK":    globalAction = GLOBAL_ACTION_BACK;    break;
            case "RECENTS": globalAction = GLOBAL_ACTION_RECENTS; break;
            default:
                Timber.w("Unsupported key via accessibility: %s", key);
                if (cb != null) cb.onResult(false, "unsupported_key:" + key);
                return;
        }
        boolean ok = svc.performGlobalAction(globalAction);
        Timber.d("Global action %s -> %b", key, ok);
        if (cb != null) cb.onResult(ok, ok ? "executed" : "global_action_failed");
    }
}
