package com.fleetops.guardian;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.util.ArrayList;
import java.util.List;

public class OfflineQueue extends SQLiteOpenHelper {
    private static final String DB_NAME    = "guardian_queue.db";
    private static final int    DB_VERSION = 2;
    private static final String TABLE      = "queue";

    // Backoff delay table in seconds
    private static final long[] BACKOFF_SECONDS = {30, 60, 120, 300, 600, 1800, 3600};

    public static class Item {
        public final long   id;
        public final String type;
        public final String payload;
        public final int    attempts;
        public final long   createdAt;
        public final int    failedPermanent;
        public final long   nextRetryAt;

        public Item(long id, String type, String payload, int attempts,
                    long createdAt, int failedPermanent, long nextRetryAt) {
            this.id              = id;
            this.type            = type;
            this.payload         = payload;
            this.attempts        = attempts;
            this.createdAt       = createdAt;
            this.failedPermanent = failedPermanent;
            this.nextRetryAt     = nextRetryAt;
        }
    }

    public OfflineQueue(Context ctx) {
        super(ctx, DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE " + TABLE + "(" +
            "id INTEGER PRIMARY KEY AUTOINCREMENT," +
            "type TEXT NOT NULL," +
            "payload TEXT NOT NULL," +
            "attempts INTEGER DEFAULT 0," +
            "created_at INTEGER NOT NULL," +
            "last_attempt INTEGER," +
            "failed_permanent INTEGER DEFAULT 0," +
            "next_retry_at INTEGER DEFAULT 0" +
            ")");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion < 2) {
            try {
                db.execSQL("ALTER TABLE " + TABLE + " ADD COLUMN failed_permanent INTEGER DEFAULT 0");
            } catch (Exception ignored) {}
            try {
                db.execSQL("ALTER TABLE " + TABLE + " ADD COLUMN next_retry_at INTEGER DEFAULT 0");
            } catch (Exception ignored) {}
        }
    }

    public synchronized void enqueue(String type, String payload) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues v = new ContentValues();
        v.put("type", type);
        v.put("payload", payload);
        v.put("attempts", 0);
        v.put("created_at", System.currentTimeMillis());
        v.put("failed_permanent", 0);
        v.put("next_retry_at", 0);
        db.insert(TABLE, null, v);
        db.close();
    }

    public synchronized List<Item> getPending() {
        long now = System.currentTimeMillis();
        List<Item> list = new ArrayList<>();
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.query(TABLE, null,
            "failed_permanent = 0 AND next_retry_at <= ?",
            new String[]{String.valueOf(now)},
            null, null,
            "created_at ASC", "20");
        while (c.moveToNext()) {
            list.add(new Item(
                c.getLong(c.getColumnIndex("id")),
                c.getString(c.getColumnIndex("type")),
                c.getString(c.getColumnIndex("payload")),
                c.getInt(c.getColumnIndex("attempts")),
                c.getLong(c.getColumnIndex("created_at")),
                c.getInt(c.getColumnIndex("failed_permanent")),
                c.getLong(c.getColumnIndex("next_retry_at"))
            ));
        }
        c.close();
        db.close();
        return list;
    }

    public synchronized void markSent(long id) {
        SQLiteDatabase db = getWritableDatabase();
        db.delete(TABLE, "id = ?", new String[]{String.valueOf(id)});
        db.close();
    }

    public synchronized void markAttempted(long id, String type, long createdAt) {
        SQLiteDatabase db = getWritableDatabase();

        // First read current attempts count
        Cursor c = db.query(TABLE, new String[]{"attempts"},
            "id = ?", new String[]{String.valueOf(id)},
            null, null, null);
        int currentAttempts = 0;
        if (c.moveToFirst()) {
            currentAttempts = c.getInt(0);
        }
        c.close();

        int newAttempts = currentAttempts + 1;
        long now = System.currentTimeMillis();

        // Compute backoff delay with ±10% jitter
        int index = newAttempts - 1;
        if (index >= BACKOFF_SECONDS.length) index = BACKOFF_SECONDS.length - 1;
        long delaySec = BACKOFF_SECONDS[index];
        double jitter = 0.9 + Math.random() * 0.2;
        long delayMs = (long)(delaySec * 1000L * jitter);
        long nextRetryAt = now + delayMs;

        // Check permanent failure threshold
        boolean permanent = false;
        if ("panic".equals(type)) {
            long thirtyDaysMs = 30L * 24 * 60 * 60 * 1000L;
            if (createdAt < now - thirtyDaysMs) {
                permanent = true;
            }
        } else if ("report".equals(type)) {
            long oneDayMs = 24L * 60 * 60 * 1000L;
            if (createdAt < now - oneDayMs) {
                permanent = true;
            }
        }

        ContentValues v = new ContentValues();
        v.put("attempts", newAttempts);
        v.put("last_attempt", now);
        v.put("next_retry_at", nextRetryAt);
        if (permanent) {
            v.put("failed_permanent", 1);
        }
        db.update(TABLE, v, "id = ?", new String[]{String.valueOf(id)});
        db.close();
    }

    public synchronized int getPendingCount() {
        long now = System.currentTimeMillis();
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.rawQuery(
            "SELECT COUNT(*) FROM " + TABLE +
            " WHERE failed_permanent = 0 AND next_retry_at <= ?",
            new String[]{String.valueOf(now)});
        int n = 0;
        if (c.moveToFirst()) n = c.getInt(0);
        c.close();
        db.close();
        return n;
    }

    public synchronized int getFailedPermanentCount() {
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.rawQuery(
            "SELECT COUNT(*) FROM " + TABLE + " WHERE failed_permanent = 1", null);
        int n = 0;
        if (c.moveToFirst()) n = c.getInt(0);
        c.close();
        db.close();
        return n;
    }

    public synchronized List<Item> getPermanentFailures() {
        List<Item> list = new ArrayList<>();
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.query(TABLE, null,
            "failed_permanent = 1",
            null, null, null,
            "created_at ASC", "10");
        while (c.moveToNext()) {
            list.add(new Item(
                c.getLong(c.getColumnIndex("id")),
                c.getString(c.getColumnIndex("type")),
                c.getString(c.getColumnIndex("payload")),
                c.getInt(c.getColumnIndex("attempts")),
                c.getLong(c.getColumnIndex("created_at")),
                c.getInt(c.getColumnIndex("failed_permanent")),
                c.getLong(c.getColumnIndex("next_retry_at"))
            ));
        }
        c.close();
        db.close();
        return list;
    }
}
