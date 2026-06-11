package com.sonalit.pegagent.commands;

import com.google.gson.annotations.SerializedName;

public class PegCommand {

    public static final String CMD_REQUEST_LOCATION = "request_location";
    public static final String CMD_TRIGGER_SIREN    = "trigger_siren";
    public static final String CMD_LOCK_SCREEN      = "lock_screen";
    public static final String CMD_FORCE_CHECKIN    = "force_checkin";
    public static final String CMD_RESTART_APP      = "restart_app";
    public static final String CMD_CLEAR_DATA       = "clear_app_data";
    public static final String CMD_REMOTE_WIPE      = "remote_wipe";
    public static final String CMD_KNOX_START       = "knox:start_session";
    public static final String CMD_KNOX_END         = "knox:end_session";
    public static final String CMD_INJECT_TOUCH     = "inject_touch";
    public static final String CMD_INJECT_KEY       = "inject_key";
    public static final String CMD_PING             = "ping";

    @SerializedName("id")
    public String id;

    @SerializedName("command")
    public String command;

    @SerializedName("payload")
    public CommandPayload payload;

    @SerializedName("issued_at")
    public String issuedAt;

    @SerializedName("ttl_hours")
    public int ttlHours = 6;

    public static class CommandPayload {
        @SerializedName("session_id")
        public String sessionId;

        @SerializedName("centrifugo_channel")
        public String centrifugoChannel;

        @SerializedName("x")
        public int x;

        @SerializedName("y")
        public int y;

        @SerializedName("action")
        public String action;

        @SerializedName("key")
        public String key;

        @SerializedName("confirm")
        public boolean confirm;
    }

    public boolean isValid() {
        return id != null && command != null;
    }
}
