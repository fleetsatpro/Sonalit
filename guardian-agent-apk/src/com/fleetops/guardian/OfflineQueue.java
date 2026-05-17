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
    private static final int    DB_VERSION = 1;
    private static final String TABLE      = "queue";
    private static final int    MAX_ATTEMPTS = 5;

    public static class Item {
        public final long   id;
        public final String type;
        public final String payload;
        public final int    attempts;
        public Item(long id, String type, String payload, int attempts) {
            this.id = id; this.type = type;
            this.payload = payload; this.attempts = attempts;
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
            "last_attempt INTEGER" +
            ")");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int o, int n) {
        db.execSQL("DROP TABLE IF EXISTS " + TABLE);
        onCreate(db);
    }

    public synchronized void enqueue(String type, String payload) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues v = new ContentValues();
        v.put("type", type);
        v.put("payload", payload);
        v.put("attempts", 0);
        v.put("created_at", System.currentTimeMillis());
        db.insert(TABLE, null, v);
        db.close();
    }

    public synchronized List<Item> getPending() {
        List<Item> list = new ArrayList<>();
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.query(TABLE, null,
            "attempts < " + MAX_ATTEMPTS, null, null, null,
            "created_at ASC", "20");
        while (c.moveToNext()) {
            list.add(new Item(
                c.getLong(c.getColumnIndex("id")),
                c.getString(c.getColumnIndex("type")),
                c.getString(c.getColumnIndex("payload")),
                c.getInt(c.getColumnIndex("attempts"))
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

    public synchronized void markAttempted(long id) {
        SQLiteDatabase db = getWritableDatabase();
        db.execSQL("UPDATE " + TABLE +
            " SET attempts = attempts + 1, last_attempt = ? WHERE id = ?",
            new Object[]{System.currentTimeMillis(), id});
        db.close();
    }

    public synchronized int getPendingCount() {
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.rawQuery(
            "SELECT COUNT(*) FROM " + TABLE + " WHERE attempts < " + MAX_ATTEMPTS, null);
        int n = 0;
        if (c.moveToFirst()) n = c.getInt(0);
        c.close();
        db.close();
        return n;
    }
}
