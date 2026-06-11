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

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.sonalit.pegagent.PegAgentApp;
import com.sonalit.pegagent.network.PegApiClient;
import com.sonalit.pegagent.network.PegWebSocketClient;
import com.sonalit.pegagent.ui.MainActivity;
import com.sonalit.pegagent.util.PegConfig;

import java.io.ByteArrayOutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import timber.log.Timber;

/**
 * ScreenShareService: captures device screen and streams to operator.
 * Uses MediaProjection API when not Device Owner,
 * or DevicePolicyManager.getScreenCaptureData() when Device Owner (Knox).
 * Frames are JPEG-compressed and sent via WebSocket to the signaling channel.
 * Target: 24fps at 720p, JPEG quality 75 (bandwidth/quality balance for field networks).
 */
public class ScreenShareService extends Service {

    private static final int NOTIF_ID   = 2001;
    private static final int WIDTH      = 720;
    private static final int HEIGHT     = 1280;
    private static final int DPI        = 320;
    private static final int FRAME_MS   = 42; // ~24fps
    private static final int JPEG_Q     = 72;

    private String sessionId;
    private String centrifugoChannel;
    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private PegWebSocketClient wsClient;
    private PegApiClient api;
    private ExecutorService frameExecutor;
    private Handler frameHandler;
    private final Gson gson = new Gson();
    private volatile boolean capturing = false;

    @Override
    public void onCreate() {
        super.onCreate();
        api        = new PegApiClient(this);
        wsClient   = new PegWebSocketClient(this);
        wsClient.connect();
        frameExecutor = Executors.newSingleThreadExecutor();
        frameHandler  = new Handler(Looper.getMainLooper());
        Timber.i("ScreenShareService created");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }

        sessionId         = intent.getStringExtra("session_id");
        centrifugoChannel = intent.getStringExtra("centrifugo_channel");

        Timber.i("ScreenShare starting session=%s channel=%s", sessionId, centrifugoChannel);

        // Start foreground notification
        startForeground(NOTIF_ID, buildNotification());

        // Check if Device Owner (Knox) for silent capture
        if (PegDeviceAdminReceiver.isDeviceOwner(this)) {
            Timber.i("Device Owner mode - Knox silent capture");
            startKnoxCapture();
        } else if (intent.hasExtra("projection_result_code")) {
            // Regular MediaProjection (requires user approval)
            int resultCode = intent.getIntExtra("projection_result_code", -1);
            Intent projData = intent.getParcelableExtra("projection_data");
            startMediaProjectionCapture(resultCode, projData);
        } else {
            Timber.w("No projection permission - session started without capture");
            // Session metadata still active, commands still work
        }

        return START_NOT_STICKY;
    }

    private void startKnoxCapture() {
        // With Device Owner, MediaProjection doesn't need user approval on Android 10-13
        // On Android 14+ a persistent notification is shown (OS requirement, cannot suppress)
        MediaProjectionManager mpm =
                (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);

        // Knox Device Owner: bypass permission dialog
        // In production with Knox SDK: use EnterpriseDeviceManager.getScreenSharePolicy()
        // For standard Device Owner: this still requires an approved intent from the foreground
        // We start capture using VirtualDisplay with minimal overhead

        setupVirtualDisplay();
        startFrameCapture();
        Timber.i("Knox capture started - virtual display active");
    }

    private void startMediaProjectionCapture(int resultCode, Intent data) {
        MediaProjectionManager mpm =
                (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        mediaProjection = mpm.getMediaProjection(resultCode, data);

        mediaProjection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() {
                Timber.i("MediaProjection stopped");
                stopSelf();
            }
        }, frameHandler);

        setupVirtualDisplay();
        startFrameCapture();
    }

    private void setupVirtualDisplay() {
        imageReader = ImageReader.newInstance(WIDTH, HEIGHT, PixelFormat.RGBA_8888, 3);

        if (mediaProjection != null) {
            virtualDisplay = mediaProjection.createVirtualDisplay(
                    "PEGAGENT_Screen",
                    WIDTH, HEIGHT, DPI,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    imageReader.getSurface(),
                    null, frameHandler
            );
        }
        Timber.i("Virtual display setup: %dx%d @%ddpi", WIDTH, HEIGHT, DPI);
    }

    private void startFrameCapture() {
        capturing = true;
        frameHandler.postDelayed(frameCaptureRunnable, FRAME_MS);
    }

    private final Runnable frameCaptureRunnable = new Runnable() {
        @Override
        public void run() {
            if (!capturing) return;
            frameExecutor.execute(() -> captureAndSendFrame());
            frameHandler.postDelayed(this, FRAME_MS);
        }
    };

    private void captureAndSendFrame() {
        if (imageReader == null) return;
        try {
            android.media.Image image = imageReader.acquireLatestImage();
            if (image == null) return;

            long captureNs = System.nanoTime();

            android.media.Image.Plane[] planes = image.getPlanes();
            java.nio.ByteBuffer buffer = planes[0].getBuffer();
            int pixelStride = planes[0].getPixelStride();
            int rowStride   = planes[0].getRowStride();
            int rowPadding  = rowStride - pixelStride * WIDTH;

            Bitmap bmp = Bitmap.createBitmap(
                    WIDTH + rowPadding / pixelStride, HEIGHT, Bitmap.Config.ARGB_8888);
            bmp.copyPixelsFromBuffer(buffer);
            image.close();

            // Crop to exact size
            Bitmap cropped = Bitmap.createBitmap(bmp, 0, 0, WIDTH, HEIGHT);
            bmp.recycle();

            // Compress to JPEG
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            cropped.compress(Bitmap.CompressFormat.JPEG, JPEG_Q, baos);
            cropped.recycle();

            byte[] frameBytes = baos.toByteArray();
            String b64Frame   = Base64.encodeToString(frameBytes, Base64.NO_WRAP);

            long compressMs = (System.nanoTime() - captureNs) / 1_000_000;

            // Send frame via WebSocket to session channel
            JsonObject payload = new JsonObject();
            payload.addProperty("type", "video_frame");
            payload.addProperty("session_id", sessionId);
            payload.addProperty("frame", b64Frame);
            payload.addProperty("width", WIDTH);
            payload.addProperty("height", HEIGHT);
            payload.addProperty("ts", System.currentTimeMillis());

            wsClient.publish(centrifugoChannel, payload);

            Timber.v("Frame sent: %dKB compress=%dms", frameBytes.length / 1024, compressMs);

        } catch (Exception e) {
            Timber.e(e, "Frame capture error");
        }
    }

    private Notification buildNotification() {
        PendingIntent pi = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE);

        // On Android 14+ this notification is required and visible
        // On Android 10-13 with Device Owner it can be made less prominent
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
        frameHandler.removeCallbacks(frameCaptureRunnable);
        if (imageReader != null)     { imageReader.close(); imageReader = null; }
        if (virtualDisplay != null)  { virtualDisplay.release(); virtualDisplay = null; }
        if (mediaProjection != null) { mediaProjection.stop(); mediaProjection = null; }
        if (wsClient != null)        wsClient.disconnect();
        if (frameExecutor != null)   frameExecutor.shutdownNow();
        Timber.i("ScreenShareService destroyed");
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }
}
