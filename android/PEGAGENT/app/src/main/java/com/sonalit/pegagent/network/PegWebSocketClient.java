package com.sonalit.pegagent.network;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.sonalit.pegagent.commands.CommandExecutor;
import com.sonalit.pegagent.commands.PegCommand;
import com.sonalit.pegagent.util.PegConfig;

import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;

import java.net.URI;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

import timber.log.Timber;

/**
 * PegWebSocketClient: persistent bidirectional channel to Centrifugo.
 *
 * Channel contract (verified against backend/src/routes/guardian.js): the server
 * publishes device commands, locations and panics to the org-wide channel
 * {@code org#<org_id>} with a {@code device.command} envelope
 * {@code {type, device_id, command_type, payload, command_id, issued_at, expires_at, signature}}.
 * Because the channel is org-wide, every frame is filtered by {@code device_id}
 * so a device only ever executes its own commands.
 *
 * ASSUMPTION (reconcile with infra): the Centrifugo connection token is the raw
 * device auth token. If Centrifugo is configured to require a signed JWT, a
 * server-side token-mint endpoint is required — see CHANGELOG.
 */
public class PegWebSocketClient {

    private final Context ctx;
    private CommandExecutor executor;
    private final Handler handler;
    private final Gson gson;
    private final String myDeviceId;
    private final AtomicBoolean connected = new AtomicBoolean(false);
    private final AtomicBoolean shouldConnect = new AtomicBoolean(false);
    private final AtomicLong reconnectDelay = new AtomicLong(PegConfig.WS_RECONNECT_BASE_MS);
    private WebSocketClient ws;
    private int messageId = 1;

    // Centrifugo protocol method IDs
    private static final int METHOD_CONNECT   = 1;
    private static final int METHOD_SUBSCRIBE = 2;
    private static final int METHOD_PUBLISH   = 7;

    public PegWebSocketClient(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.handler = new Handler(Looper.getMainLooper());
        this.gson = new Gson();
        this.myDeviceId = PegConfig.getDeviceId(ctx);
    }

    public void setCommandExecutor(CommandExecutor executor) {
        this.executor = executor;
    }

    public void connect() {
        shouldConnect.set(true);
        connectInternal();
    }

    public void disconnect() {
        shouldConnect.set(false);
        connected.set(false);
        if (ws != null) {
            try { ws.close(); } catch (Exception ignored) {}
        }
        handler.removeCallbacksAndMessages(null);
        Timber.i("WebSocket disconnected by request");
    }

    /** Network regained — reset backoff and reconnect immediately if needed (P2-2). */
    public void onNetworkAvailable() {
        if (!shouldConnect.get()) return;
        reconnectDelay.set(PegConfig.WS_RECONNECT_BASE_MS);
        if (!connected.get()) {
            handler.removeCallbacksAndMessages(null);
            handler.post(this::connectInternal);
        }
    }

    /** Re-issue the channel subscription (after an org_id backfill, P0-2). */
    public void resubscribe() {
        if (connected.get()) subscribeToCommandChannel();
    }

    private void connectInternal() {
        if (!shouldConnect.get()) return;

        String wsUrl = PegConfig.getWsUrl(ctx);
        String token  = PegConfig.getWsToken(ctx);

        if (wsUrl == null || token == null) {
            Timber.w("WS connect skipped - not enrolled");
            scheduleReconnect();
            return;
        }

        try {
            URI uri = URI.create(wsUrl);
            Map<String, String> headers = new HashMap<>();
            headers.put("Authorization", "Bearer " + PegConfig.getAuthToken(ctx));

            ws = new WebSocketClient(uri, new org.java_websocket.drafts.Draft_6455(), headers, 10_000) {
                @Override
                public void onOpen(ServerHandshake hs) {
                    Timber.i("WS connected to %s", wsUrl);
                    connected.set(true);
                    reconnectDelay.set(PegConfig.WS_RECONNECT_BASE_MS);
                    sendConnect(token);
                }

                @Override
                public void onMessage(String message) {
                    handleMessage(message);
                }

                @Override
                public void onClose(int code, String reason, boolean remote) {
                    connected.set(false);
                    Timber.w("WS closed code=%d reason=%s remote=%b", code, reason, remote);
                    if (shouldConnect.get()) scheduleReconnect();
                }

                @Override
                public void onError(Exception ex) {
                    connected.set(false);
                    Timber.e(ex, "WS error");
                    if (shouldConnect.get()) scheduleReconnect();
                }
            };
            // Keepalive / half-open detection (P2-5): library-level ping every 15s;
            // a missing pong tears the socket down so the reconnect ladder kicks in.
            ws.setConnectionLostTimeout(15);
            ws.connect();
        } catch (Exception e) {
            Timber.e(e, "WS connect failed");
            scheduleReconnect();
        }
    }

    private void handleMessage(String raw) {
        try {
            JsonObject msg = JsonParser.parseString(raw).getAsJsonObject();

            // Top-level error frame (Centrifugo): { id, error: { code, message } }
            if (msg.has("error") && msg.get("error").isJsonObject()) {
                handleErrorFrame(msg.getAsJsonObject("error"));
                return;
            }

            // Push frame: { push: { channel, pub: { data } } }
            if (msg.has("push")) {
                JsonObject push = msg.getAsJsonObject("push");
                if (push.has("pub")) {
                    JsonObject pub = push.getAsJsonObject("pub");
                    if (pub.has("data") && pub.get("data").isJsonObject()) {
                        dispatchData(pub.getAsJsonObject("data"));
                    }
                }
                return;
            }

            // Connect reply — subscribe (or surface embedded error)
            if (msg.has("connect")) {
                JsonElement c = msg.get("connect");
                if (c.isJsonObject() && c.getAsJsonObject().has("error")) {
                    handleErrorFrame(c.getAsJsonObject().getAsJsonObject("error"));
                } else {
                    Timber.d("WS connect reply received");
                    subscribeToCommandChannel();
                }
                return;
            }

            // Subscribe reply
            if (msg.has("subscribe")) {
                JsonElement s = msg.get("subscribe");
                if (s.isJsonObject() && s.getAsJsonObject().has("error")) {
                    handleErrorFrame(s.getAsJsonObject().getAsJsonObject("error"));
                } else {
                    Timber.i("WS subscribed to command channel");
                }
                return;
            }
        } catch (Exception e) {
            Timber.e(e, "WS message parse error: %s", raw);
        }
    }

    /** Route a command envelope, filtering by device_id (org-wide channel). */
    private void dispatchData(JsonObject data) {
        try {
            // The org channel also carries location/panic broadcasts — only act on commands.
            if (data.has("type") && !data.get("type").isJsonNull()) {
                String type = data.get("type").getAsString();
                if (!"device.command".equals(type)) {
                    Timber.v("Ignoring non-command frame type=%s", type);
                    return;
                }
            }
            if (data.has("device_id") && !data.get("device_id").isJsonNull() && myDeviceId != null) {
                String targetDevice = data.get("device_id").getAsString();
                if (!myDeviceId.equals(targetDevice)) {
                    Timber.v("Ignoring command for other device %s", targetDevice);
                    return;
                }
            }
            PegCommand cmd = gson.fromJson(data, PegCommand.class);
            JsonElement rawPayload = data.has("payload") ? data.get("payload") : null;
            if (executor != null && cmd != null && cmd.isValid()) {
                executor.execute(cmd, rawPayload);
            }
        } catch (Exception e) {
            Timber.e(e, "dispatchData error");
        }
    }

    private void handleErrorFrame(JsonObject error) {
        int code = error.has("code") ? error.get("code").getAsInt() : -1;
        String message = error.has("message") ? error.get("message").getAsString() : "?";
        Timber.w("Centrifugo error code=%d message=%s", code, message);

        // Centrifugo token-expired / unauthorized codes → close and reconnect with
        // backoff instead of a blind tight loop. (The device token is a non-expiring
        // UUID; if the deployment mints signed Centrifugo JWTs a token-refresh endpoint
        // is required — see CHANGELOG assumptions.)
        boolean authError = code == 109 /* token expired */ || code == 3500 /* invalid token */
                || code == 105 /* permission denied */;
        if (authError) {
            Timber.w("WS auth error %d — closing and backing off", code);
            connected.set(false);
            if (ws != null) { try { ws.close(); } catch (Exception ignored) {} }
            if (shouldConnect.get()) scheduleReconnect();
        }
    }

    private void sendConnect(String token) {
        JsonObject connectParams = new JsonObject();
        connectParams.addProperty("token", token);
        send(METHOD_CONNECT, connectParams);
    }

    private void subscribeToCommandChannel() {
        String channel = resolveCommandChannel();
        if (channel == null) {
            Timber.w("Cannot subscribe - no org_id/channel available yet");
            return;
        }
        JsonObject subParams = new JsonObject();
        subParams.addProperty("channel", channel);
        send(METHOD_SUBSCRIBE, subParams);
        Timber.i("Subscribed to command channel: %s", channel);
    }

    /**
     * Prefer a server-dictated channel if one was provided at enrollment; otherwise
     * use the verified org-wide template {@code org#<org_id>}.
     */
    private String resolveCommandChannel() {
        String serverChannel = PegConfig.getCommandChannel(ctx);
        if (serverChannel != null && !serverChannel.isEmpty()) return serverChannel;
        String orgId = PegConfig.getOrgId(ctx);
        if (orgId == null || orgId.isEmpty()) return null;
        return "org#" + orgId;
    }

    private void send(int method, JsonObject params) {
        if (ws == null || !connected.get()) return;
        JsonObject frame = new JsonObject();
        frame.addProperty("id", messageId++);
        frame.addProperty("method", method);
        frame.add("params", params);
        try {
            ws.send(frame.toString());
        } catch (Exception e) {
            Timber.e(e, "WS send failed");
        }
    }

    /** Publish a message to the server (used for screen-share frames). */
    public void publish(String channel, JsonObject data) {
        if (!connected.get()) return;
        JsonObject params = new JsonObject();
        params.addProperty("channel", channel);
        params.add("data", data);
        send(METHOD_PUBLISH, params);
    }

    private void scheduleReconnect() {
        long delay = reconnectDelay.get();
        Timber.i("WS reconnecting in %dms", delay);
        handler.postDelayed(this::connectInternal, delay);
        long next = Math.min(delay * 2, PegConfig.WS_RECONNECT_MAX_MS);
        reconnectDelay.set(next);
    }

    public boolean isConnected() {
        return connected.get();
    }
}
