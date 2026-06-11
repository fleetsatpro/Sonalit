package com.sonalit.pegagent.network;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import com.google.gson.Gson;
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
 * Connects to org:{orgId}:device:{deviceId}:commands channel.
 * Reconnects automatically with exponential backoff.
 * Command delivery latency target: <50ms from server publish to executor.execute().
 */
public class PegWebSocketClient {

    private final Context ctx;
    private CommandExecutor executor;
    private final Handler handler;
    private final Gson gson;
    private final AtomicBoolean connected = new AtomicBoolean(false);
    private final AtomicBoolean shouldConnect = new AtomicBoolean(false);
    private final AtomicLong reconnectDelay = new AtomicLong(PegConfig.WS_RECONNECT_BASE_MS);
    private WebSocketClient ws;
    private int messageId = 1;
    private String subscriptionId;

    // Centrifugo protocol v2 method IDs
    private static final int METHOD_CONNECT   = 1;
    private static final int METHOD_SUBSCRIBE = 2;
    private static final int METHOD_PUBLISH   = 7;

    public PegWebSocketClient(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        this.handler = new Handler(Looper.getMainLooper());
        this.gson = new Gson();
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
                    reconnectDelay.set(PegConfig.WS_RECONNECT_BASE_MS); // reset backoff
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
            ws.connect();
        } catch (Exception e) {
            Timber.e(e, "WS connect failed");
            scheduleReconnect();
        }
    }

    private void handleMessage(String raw) {
        long recvNs = System.nanoTime();
        try {
            JsonObject msg = JsonParser.parseString(raw).getAsJsonObject();

            // Centrifugo push frame: { "push": { "channel": "...", "pub": { "data": {...} } } }
            if (msg.has("push")) {
                JsonObject push = msg.getAsJsonObject("push");
                if (push.has("pub")) {
                    JsonObject pub  = push.getAsJsonObject("pub");
                    JsonObject data = pub.getAsJsonObject("data");

                    if (data != null) {
                        PegCommand cmd = gson.fromJson(data, PegCommand.class);
                        long latencyMs = (System.nanoTime() - recvNs) / 1_000_000;
                        Timber.d("WS command received, parse latency=%dms", latencyMs);

                        if (executor != null && cmd != null && cmd.isValid()) {
                            executor.execute(cmd); // dispatches immediately, non-blocking
                        }
                    }
                }
                return;
            }

            // Connect reply - subscribe to command channel
            if (msg.has("id") && msg.has("connect")) {
                Timber.d("WS connect reply received");
                subscribeToCommandChannel();
                return;
            }

            // Subscribe reply
            if (msg.has("id") && msg.has("subscribe")) {
                Timber.i("WS subscribed to command channel");
                return;
            }

        } catch (Exception e) {
            Timber.e(e, "WS message parse error: %s", raw);
        }
    }

    private void sendConnect(String token) {
        JsonObject connectParams = new JsonObject();
        connectParams.addProperty("token", token);
        send(METHOD_CONNECT, connectParams);
    }

    private void subscribeToCommandChannel() {
        String orgId    = PegConfig.getOrgId(ctx);
        String deviceId = PegConfig.getDeviceId(ctx);

        if (orgId == null || deviceId == null) {
            Timber.w("Cannot subscribe - orgId or deviceId null");
            return;
        }

        // Subscribe to command channel
        String cmdChannel = "org:" + orgId + ":device:" + deviceId + ":commands";
        JsonObject subParams = new JsonObject();
        subParams.addProperty("channel", cmdChannel);
        subscriptionId = cmdChannel;
        send(METHOD_SUBSCRIBE, subParams);

        // Also subscribe to remote control channel for touch/key injection
        String rcChannel = "org:" + orgId + ":device:" + deviceId + ":remote_control";
        JsonObject rcParams = new JsonObject();
        rcParams.addProperty("channel", rcChannel);
        send(METHOD_SUBSCRIBE, rcParams);

        Timber.i("Subscribed to channels: %s, %s", cmdChannel, rcChannel);
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

    /** Publish a message to the server (used for telemetry ACKs) */
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

        // Exponential backoff with ceiling
        long next = Math.min(delay * 2, PegConfig.WS_RECONNECT_MAX_MS);
        reconnectDelay.set(next);
    }

    public boolean isConnected() {
        return connected.get();
    }
}
