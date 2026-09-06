package com.sonalit.pegagent.commands;

import com.google.gson.annotations.SerializedName;

public class PegCommand {

    public static final String CMD_REQUEST_LOCATION = "request_location";
    public static final String CMD_TRIGGER_SIREN    = "trigger_siren";
    public static final String CMD_STOP_SIREN       = "stop_siren";
    public static final String CMD_TRIGGER_SOS      = "trigger_sos";
    public static final String CMD_PANIC_CANCEL     = "panic_cancel";
    public static final String CMD_LOCK_SCREEN      = "lock_screen";
    public static final String CMD_FORCE_CHECKIN    = "force_checkin";
    public static final String CMD_RESTART_APP      = "restart_app";
    public static final String CMD_CLEAR_CACHE      = "clear_cache";
    public static final String CMD_CLEAR_DATA       = "clear_app_data";
    public static final String CMD_REMOTE_WIPE      = "remote_wipe";
    public static final String CMD_UPDATE_APP       = "update_app";
    public static final String CMD_KNOX_START       = "knox:start_session";
    public static final String CMD_KNOX_END         = "knox:end_session";
    public static final String CMD_INJECT_TOUCH     = "inject_touch";
    public static final String CMD_INJECT_KEY       = "inject_key";
    public static final String CMD_PING             = "ping";

    // Server WS payloads use "command_id"; heartbeat rows use "id".
    @SerializedName(value = "id", alternate = {"command_id"})
    public String id;

    @SerializedName(value = "command", alternate = {"command_type"})
    public String command;

    @SerializedName("payload")
    public CommandPayload payload;

    @SerializedName("issued_at")
    public String issuedAt;

    @SerializedName("expires_at")
    public String expiresAt;

    @SerializedName("ttl_hours")
    public int ttlHours = 6;

    // HMAC-SHA256 of id:command_type:sha256(canonicalJson(payload)):issued_at:expires_at
    @SerializedName("signature")
    public String signature;

    public static class CommandPayload {
        @SerializedName("session_id")
        public String sessionId;

        @SerializedName("centrifugo_channel")
        public String centrifugoChannel;

        @SerializedName("x")
        public int x;

        @SerializedName("y")
        public int y;

        // Swipe end coordinates (capture-space).
        @SerializedName("x2")
        public int x2;

        @SerializedName("y2")
        public int y2;

        // Capture / operator-viewport resolution the x,y are expressed in (P1-4).
        @SerializedName("capture_width")
        public int captureWidth;

        @SerializedName("capture_height")
        public int captureHeight;

        @SerializedName("action")
        public String action;

        @SerializedName("key")
        public String key;

        @SerializedName("confirm")
        public boolean confirm;

        // clear_app_data: when true, wipe everything and let the OS restart the app.
        @SerializedName("full")
        public boolean full;

        // trigger_siren duration; 0 → default.
        @SerializedName("duration_sec")
        public int durationSec;

        // trigger_sos / panic source + mode passthrough.
        @SerializedName("source")
        public String source;

        @SerializedName("mode")
        public String mode;

        // remote_wipe: also wipe external storage (P3-1).
        @SerializedName("wipe_external")
        public boolean wipeExternal;

        // update_app: signed APK download URL.
        @SerializedName("url")
        public String url;
    }

    public boolean isValid() {
        return id != null && command != null;
    }
}
