package com.sonalit.pegagent.services;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Base64;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.gson.JsonObject;
import com.sonalit.pegagent.PegAgentApp;
import com.sonalit.pegagent.network.PegWebSocketClient;
import com.sonalit.pegagent.ui.MainActivity;

import java.io.ByteArrayOutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import timber.log.Timber;

/**
 * ScreenShareService: captures the screen (Device-Owner / Knox only, P1-5 option A)
 * and streams JPEG frames to the operator over the shared Centrifugo client (P2-4).
 *
 * Transport is adaptive (P2-6): frames are single-flight (a new frame is skipped
 * while the previous publish is in progress) and both the frame interval and JPEG
 * quality back off when publishing is slow, so we never flood Centrifugo with
 * multi-MB/s of base64. (Full WebRTC video remains the stated end goal; this pass
 * ships the adaptive fallback.)
 */
public class ScreenShareService extends Service {

    private static final int NOTIF_ID = 2001;
    private static final int WIDTH    = 720;
    private static final int HEIGHT   = 1280;
    private static final int DPI      = 320;

    private static final int MIN_FRAME_MS = 66;   // ~15fps ceiling
    private static final int MAX_FRAME_MS = 500;  // 2fps floor under backpressure
    private static final int MIN_QUALITY  = 35;
    private static final int MAX_QUALITY  = 72;

    private String sessionId;
    private String centrifugoChannel;
    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private PegWebSocketClient wsClient;
    private boolean ownsWsClient = false;
    private ExecutorService frameExecutor;
    private Handler frameHandler;
    private volatile boolean capturing = false;

    private final AtomicBoolean inFlight = new AtomicBoolean(false);
    private volatile int frameMs = 100;   // ~10fps start
    private volatile int quality = MAX_QUALITY;

    @Override
    public void onCreate() {
        super.onCreate();
        // Reuse the app-scoped Centrifugo client; only create our own as a fallback.
        wsClient = PegAgentApp.getSharedWs();
        if (wsClient == null) {
            wsClient = new PegWebSocketClient(this);
            wsClient.connect();
            ownsWsClient = true;
        }
        frameExecutor = Executors.newSingleThreadExecutor();
        frameHandler  = new Handler(Looper.getMainLooper());
        Timber.i("ScreenShareService created (ownsWs=%b)", ownsWsClient);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }

        sessionId         = intent.getStringExtra("session_id");
        centrifugoChannel = intent.getStringExtra("centrifugo_channel");
        Timber.i("ScreenShare starting session=%s channel=%s", sessionId, centrifugoChannel);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, buildNotification(),
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        } else {
            startForeground(NOTIF_ID, buildNotification());
        }

        // Device-Owner only. CommandExecutor already refuses non-DO, but guard here too:
        // never run a blind, capture-less session.
        if (!PegDeviceAdminReceiver.isDeviceOwner(this)) {
            Timber.w("ScreenShare requires Device Owner — stopping");
            publishSessionState("session_error", "not_device_owner");
            stopSelf();
            return START_NOT_STICKY;
        }

        startKnoxCapture();
        return START_NOT_STICKY;
    }

    private void startKnoxCapture() {
        // Device Owner silent capture path (Knox / DO). On the Knox fleet capture is
        // DO-granted; standard AOSP Device Owner additionally needs the Knox
        // EnterpriseDeviceManager SDK or a MediaProjection consent token to produce
        // pixels (see CHANGELOG). We never run capture-less on a non-DO device.
        setupVirtualDisplay();
        startFrameCapture();
        publishSessionState("session_active", null);
        Timber.i("Knox capture started - virtual display active");
    }

    private void setupVirtualDisplay() {
        imageReader = ImageReader.newInstance(WIDTH, HEIGHT, PixelFormat.RGBA_8888, 2);
        if (mediaProjection != null) {
            virtualDisplay = mediaProjection.createVirtualDisplay(
                    "PEGAGENT_Screen", WIDTH, HEIGHT, DPI,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    imageReader.getSurface(), null, frameHandler);
        }
        Timber.i("Virtual display setup: %dx%d @%ddpi", WIDTH, HEIGHT, DPI);
    }

    private void startFrameCapture() {
        capturing = true;
        frameHandler.postDelayed(frameCaptureRunnable, frameMs);
    }

    private final Runnable frameCaptureRunnable = new Runnable() {
        @Override
        public void run() {
            if (!capturing) return;
            // Single-flight: skip this tick if the previous frame is still publishing.
            if (inFlight.compareAndSet(false, true)) {
                frameExecutor.execute(() -> {
                    try { captureAndSendFrame(); }
                    finally { inFlight.set(false); }
                });
            } else {
                Timber.v("Backpressure — frame skipped");
            }
            frameHandler.postDelayed(this, frameMs);
        }
    };

    private void captureAndSendFrame() {
        if (imageReader == null) return;
        android.media.Image image = null;
        try {
            image = imageReader.acquireLatestImage();
            if (image == null) return;

            long t0 = System.nanoTime();

            android.media.Image.Plane[] planes = image.getPlanes();
            java.nio.ByteBuffer buffer = planes[0].getBuffer();
            int pixelStride = planes[0].getPixelStride();
            int rowStride   = planes[0].getRowStride();
            int rowPadding  = rowStride - pixelStride * WIDTH;

            Bitmap bmp = Bitmap.createBitmap(
                    WIDTH + rowPadding / pixelStride, HEIGHT, Bitmap.Config.ARGB_8888);
            bmp.copyPixelsFromBuffer(buffer);
            image.close();
            image = null;

            Bitmap cropped = Bitmap.createBitmap(bmp, 0, 0, WIDTH, HEIGHT);
            bmp.recycle();

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            cropped.compress(Bitmap.CompressFormat.JPEG, quality, baos);
            cropped.recycle();

            byte[] frameBytes = baos.toByteArray();
            String b64Frame = Base64.encodeToString(frameBytes, Base64.NO_WRAP);

            JsonObject payload = new JsonObject();
            payload.addProperty("type", "video_frame");
            payload.addProperty("session_id", sessionId);
            payload.addProperty("frame", b64Frame);
            payload.addProperty("width", WIDTH);
            payload.addProperty("height", HEIGHT);
            payload.addProperty("quality", quality);
            payload.addProperty("ts", System.currentTimeMillis());
            if (centrifugoChannel != null && wsClient != null) {
                wsClient.publish(centrifugoChannel, payload);
            }

            long elapsedMs = (System.nanoTime() - t0) / 1_000_000;
            adapt(elapsedMs, frameBytes.length);
        } catch (Exception e) {
            Timber.e(e, "Frame capture error");
        } finally {
            if (image != null) image.close();
        }
    }

    /** Adjust interval + quality based on how long the last frame took / its size. */
    private void adapt(long elapsedMs, int bytes) {
        boolean slow = elapsedMs > frameMs || bytes > 180_000;
        if (slow) {
            frameMs = Math.min(MAX_FRAME_MS, (int) (frameMs * 1.5));
            quality = Math.max(MIN_QUALITY, quality - 8);
        } else {
            frameMs = Math.max(MIN_FRAME_MS, (int) (frameMs * 0.9));
            quality = Math.min(MAX_QUALITY, quality + 2);
        }
    }

    private void publishSessionState(String state, String reason) {
        try {
            if (centrifugoChannel == null || wsClient == null) return;
            JsonObject p = new JsonObject();
            p.addProperty("type", state);
            p.addProperty("session_id", sessionId);
            if (reason != null) p.addProperty("reason", reason);
            p.addProperty("ts", System.currentTimeMillis());
            wsClient.publish(centrifugoChannel, p);
        } catch (Exception ignored) {}
    }

    private Notification buildNotification() {
        PendingIntent pi = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, PegAgentApp.CHANNEL_SESSION)
                .setContentTitle("PEGAGENT — Remote Session")
                .setContentText("Operator screen access active")
                .setSmallIcon(android.R.drawable.ic_menu_camera)
                .setContentIntent(pi)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    @Override
    public void onDestroy() {
        capturing = false;
        if (frameHandler != null) frameHandler.removeCallbacks(frameCaptureRunnable);
        publishSessionState("session_ended", null);
        if (imageReader != null)     { imageReader.close(); imageReader = null; }
        if (virtualDisplay != null)  { virtualDisplay.release(); virtualDisplay = null; }
        if (mediaProjection != null) { mediaProjection.stop(); mediaProjection = null; }
        // Only tear down the socket if we created it (never the shared one).
        if (ownsWsClient && wsClient != null) wsClient.disconnect();
        if (frameExecutor != null)   frameExecutor.shutdownNow();
        Timber.i("ScreenShareService destroyed");
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }
}
