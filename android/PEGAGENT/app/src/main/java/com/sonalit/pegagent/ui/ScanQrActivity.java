package com.sonalit.pegagent.ui;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;
import com.sonalit.pegagent.util.PegConfig;

import java.io.IOException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import timber.log.Timber;

/**
 * Opens the rear camera, scans the enrollment QR code, parses the JSON payload,
 * saves enrollment data, fetches a Centrifugo WS token, then finishes with
 * RESULT_OK so MainActivity can refresh and start services.
 *
 * Expected QR JSON:
 * {
 *   "server": "https://api.sonalit.com",
 *   "org_id": "uuid",
 *   "token":  "enrollment_token",
 *   "badge":  "FO-012",
 *   "officer_id": "uuid"   // optional
 * }
 */
public class ScanQrActivity extends AppCompatActivity {

    public static final String EXTRA_RESULT = "enrollment_result";

    private static final MediaType JSON_TYPE = MediaType.get("application/json; charset=utf-8");

    private PreviewView previewView;
    private final ExecutorService cameraExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean processed = new AtomicBoolean(false);
    private BarcodeScanner scanner;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Dark fullscreen preview with a status label
        android.widget.FrameLayout root = new android.widget.FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        previewView = new PreviewView(this);
        root.addView(previewView, new android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT));

        TextView label = new TextView(this);
        label.setText("Point camera at enrollment QR code");
        label.setTextColor(Color.WHITE);
        label.setBackgroundColor(0xCC000000);
        label.setPadding(24, 16, 24, 16);
        label.setTextSize(14f);
        android.widget.FrameLayout.LayoutParams lp = new android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.WRAP_CONTENT,
                android.widget.FrameLayout.LayoutParams.WRAP_CONTENT);
        lp.gravity = android.view.Gravity.BOTTOM | android.view.Gravity.CENTER_HORIZONTAL;
        lp.bottomMargin = 80;
        label.setLayoutParams(lp);
        root.addView(label);

        setContentView(root);
        startCamera();
    }

    private void startCamera() {
        BarcodeScannerOptions opts = new BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .build();
        scanner = BarcodeScanning.getClient(opts);

        ListenableFuture<ProcessCameraProvider> future =
                ProcessCameraProvider.getInstance(this);

        future.addListener(() -> {
            try {
                ProcessCameraProvider provider = future.get();
                bindCamera(provider);
            } catch (ExecutionException | InterruptedException e) {
                Timber.e(e, "Camera provider error");
                finishWithError("Camera unavailable");
            }
        }, ContextCompat.getMainExecutor(this));
    }

    @androidx.camera.core.ExperimentalGetImage
    private void bindCamera(@NonNull ProcessCameraProvider provider) {
        Preview preview = new Preview.Builder().build();
        preview.setSurfaceProvider(previewView.getSurfaceProvider());

        ImageAnalysis analysis = new ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build();

        analysis.setAnalyzer(cameraExecutor, imageProxy -> {
            if (processed.get()) {
                imageProxy.close();
                return;
            }
            android.media.Image mediaImage = imageProxy.getImage();
            if (mediaImage == null) {
                imageProxy.close();
                return;
            }
            InputImage image = InputImage.fromMediaImage(
                    mediaImage, imageProxy.getImageInfo().getRotationDegrees());

            scanner.process(image)
                    .addOnSuccessListener(barcodes -> {
                        for (Barcode barcode : barcodes) {
                            String raw = barcode.getRawValue();
                            if (raw != null && !raw.isEmpty() && processed.compareAndSet(false, true)) {
                                handleQrResult(raw);
                            }
                        }
                    })
                    .addOnFailureListener(e -> Timber.w(e, "Barcode scan failed"))
                    .addOnCompleteListener(task -> imageProxy.close());
        });

        provider.unbindAll();
        provider.bindToLifecycle(this,
                CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis);
    }

    private void handleQrResult(String raw) {
        try {
            Gson gson = new Gson();
            JsonObject qr = gson.fromJson(raw, JsonObject.class);

            String server    = qr.has("server")     ? qr.get("server").getAsString()     : null;
            String orgId     = qr.has("org_id")     ? qr.get("org_id").getAsString()     : null;
            String token     = qr.has("token")      ? qr.get("token").getAsString()      : null;
            String badge     = qr.has("badge")      ? qr.get("badge").getAsString()      : null;
            String officerId = qr.has("officer_id") ? qr.get("officer_id").getAsString() : "";

            if (server == null || orgId == null || token == null || badge == null) {
                runOnUiThread(() -> {
                    Toast.makeText(this, "Invalid QR: missing required fields", Toast.LENGTH_LONG).show();
                    processed.set(false); // allow retry
                });
                return;
            }

            // Generate a stable device ID from Android ID
            String deviceId = android.provider.Settings.Secure.getString(
                    getContentResolver(), android.provider.Settings.Secure.ANDROID_ID);

            // Save enrollment first so WS token fetch has auth token
            PegConfig.saveEnrollment(server, orgId, deviceId, token, token, badge, officerId);

            // Fetch a real WS token from the backend
            String wsToken = fetchWsToken(server, orgId, deviceId, token);
            if (wsToken != null) {
                PegConfig.saveWsToken(wsToken);
            }

            runOnUiThread(() -> {
                Toast.makeText(this, "Enrolled as " + badge, Toast.LENGTH_SHORT).show();
                setResult(RESULT_OK, new Intent().putExtra(EXTRA_RESULT, "ok"));
                finish();
            });

        } catch (Exception e) {
            Timber.e(e, "QR parse error");
            runOnUiThread(() -> {
                Toast.makeText(this, "QR parse failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
                processed.set(false);
            });
        }
    }

    /** Synchronous — called from background thread. Returns token or null on failure. */
    private String fetchWsToken(String server, String orgId, String deviceId, String authToken) {
        try {
            OkHttpClient http = new OkHttpClient.Builder()
                    .connectTimeout(10, TimeUnit.SECONDS)
                    .readTimeout(10, TimeUnit.SECONDS)
                    .build();

            String url = server + "/api/guardian/devices/" + deviceId + "/ws-token";
            Request req = new Request.Builder()
                    .url(url)
                    .post(RequestBody.create("{}", JSON_TYPE))
                    .header("Authorization", "Bearer " + authToken)
                    .build();

            try (Response resp = http.newCall(req).execute()) {
                if (resp.isSuccessful() && resp.body() != null) {
                    JsonObject body = new Gson().fromJson(resp.body().string(), JsonObject.class);
                    if (body.has("token")) return body.get("token").getAsString();
                }
                Timber.w("WS token fetch failed: HTTP %d", resp.code());
            }
        } catch (IOException e) {
            Timber.w(e, "WS token fetch error");
        }
        return null;
    }

    private void finishWithError(String msg) {
        runOnUiThread(() -> {
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
            setResult(RESULT_CANCELED);
            finish();
        });
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        cameraExecutor.shutdownNow();
        if (scanner != null) scanner.close();
    }
}
