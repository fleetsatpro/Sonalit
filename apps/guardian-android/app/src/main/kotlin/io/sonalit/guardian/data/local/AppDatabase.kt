package io.sonalit.guardian.data.local

import androidx.room.*
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

// ── GPS fixes ─────────────────────────────────────────────────────────────────

@Entity(tableName = "gps_fixes")
data class GpsFixEntity(
    @PrimaryKey val id: String,
    val lat: Double,
    val lon: Double,
    val speed: Float,
    val heading: Float,
    val accuracy: Float,
    val ts: Long,
    val synced: Boolean,
)

@Dao
interface GpsFixDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(fix: GpsFixEntity)

    @Query("SELECT * FROM gps_fixes WHERE synced = 0 ORDER BY ts ASC LIMIT :limit")
    suspend fun getUnsynced(limit: Int): List<GpsFixEntity>

    @Query("SELECT * FROM gps_fixes ORDER BY ts DESC LIMIT 1")
    suspend fun getLatest(): GpsFixEntity?

    @Query("SELECT COUNT(*) FROM gps_fixes WHERE synced = 0")
    suspend fun countUnsynced(): Int

    @Query("UPDATE gps_fixes SET synced = 1 WHERE id IN (:ids)")
    suspend fun markSynced(ids: List<String>)

    @Query("DELETE FROM gps_fixes WHERE synced = 1 AND ts < :cutoffMs")
    suspend fun pruneOld(cutoffMs: Long)
}

// ── Pending photos (offline queue) ────────────────────────────────────────────

@Entity(tableName = "pending_photos")
data class PendingPhotoEntity(
    @PrimaryKey val eventUuid: String,
    val convoyId: String,
    val truckId: String,
    val session: String,      // sod | eod
    val photoType: String,    // front | rear | seal
    val sealPosition: String?,
    val reportDate: String,
    val localFilePath: String,
    val takenAt: String,
    val lat: Double?,
    val lng: Double?,
    val notes: String?,
    val createdAt: Long,
    val attempts: Int = 0,
    val lastError: String? = null,
    // Empty for rows created before ownership was recorded. Such legacy
    // evidence is retained but never retried under whichever account logs in.
    @ColumnInfo(defaultValue = "''") val ownerUserId: String = "",
)

@Dao
interface PendingPhotoDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(photo: PendingPhotoEntity): Long

    @Query("SELECT * FROM pending_photos WHERE ownerUserId = :ownerUserId ORDER BY createdAt ASC")
    suspend fun getAll(ownerUserId: String): List<PendingPhotoEntity>

    @Query("SELECT * FROM pending_photos WHERE ownerUserId = :ownerUserId AND attempts < :maxAttempts ORDER BY createdAt ASC LIMIT :limit")
    suspend fun getPending(ownerUserId: String, maxAttempts: Int, limit: Int): List<PendingPhotoEntity>

    @Query("SELECT * FROM pending_photos WHERE ownerUserId = :ownerUserId AND attempts >= :maxAttempts ORDER BY createdAt DESC LIMIT :limit")
    suspend fun getExhausted(ownerUserId: String, maxAttempts: Int, limit: Int): List<PendingPhotoEntity>

    @Query("UPDATE pending_photos SET attempts = attempts + 1, lastError = :err WHERE eventUuid = :id")
    suspend fun incrementAttempt(id: String, err: String)

    /** Operator retry preserves the file and event UUID while resetting only the retry budget. */
    @Query("UPDATE pending_photos SET attempts = 0, lastError = NULL WHERE ownerUserId = :ownerUserId AND attempts >= :maxAttempts")
    suspend fun resetExhausted(ownerUserId: String, maxAttempts: Int): Int

    @Query("DELETE FROM pending_photos WHERE eventUuid = :id")
    suspend fun delete(id: String)

    @Query("SELECT COUNT(*) FROM pending_photos WHERE ownerUserId = :ownerUserId AND attempts < :maxAttempts")
    suspend fun countPending(ownerUserId: String, maxAttempts: Int): Int

    @Query("SELECT COUNT(*) FROM pending_photos WHERE ownerUserId = :ownerUserId AND attempts >= :maxAttempts")
    suspend fun countExhausted(ownerUserId: String, maxAttempts: Int): Int

}

// ── Dispatch inbox (show_message / play_voice_message commands) ──────────────

@Entity(tableName = "dispatch_messages")
data class DispatchMessageEntity(
    @PrimaryKey val id: String,
    val kind: String,          // text | voice
    val text: String?,         // text messages, or the voice message's fallback label
    val voiceUrl: String?,
    val receivedAt: Long,
    val read: Boolean = false,
)

@Dao
interface DispatchMessageDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(message: DispatchMessageEntity)

    @Query("SELECT * FROM dispatch_messages ORDER BY receivedAt DESC LIMIT :limit")
    fun recent(limit: Int = 20): kotlinx.coroutines.flow.Flow<List<DispatchMessageEntity>>

    @Query("SELECT COUNT(*) FROM dispatch_messages WHERE read = 0")
    fun unreadCount(): kotlinx.coroutines.flow.Flow<Int>

    @Query("UPDATE dispatch_messages SET read = 1 WHERE id = :id")
    suspend fun markRead(id: String)

    @Query("DELETE FROM dispatch_messages WHERE receivedAt < :cutoffMs")
    suspend fun pruneOld(cutoffMs: Long)
}

// ── Recent activity (SOS + device-health flag history) ────────────────────────

@Entity(tableName = "activity_events")
data class ActivityEventEntity(
    @PrimaryKey val id: String,
    val kind: String,          // sos | health
    val title: String,
    val detail: String?,
    val severity: String,      // ok | warn
    val occurredAt: Long,
)

@Dao
interface ActivityEventDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(event: ActivityEventEntity)

    @Query("SELECT * FROM activity_events ORDER BY occurredAt DESC LIMIT :limit")
    fun recent(limit: Int = 10): kotlinx.coroutines.flow.Flow<List<ActivityEventEntity>>

    @Query("DELETE FROM activity_events WHERE occurredAt < :cutoffMs")
    suspend fun pruneOld(cutoffMs: Long)
}

// ── Database ──────────────────────────────────────────────────────────────────

@Database(
    entities = [
        GpsFixEntity::class, PendingPhotoEntity::class,
        DispatchMessageEntity::class, ActivityEventEntity::class,
    ],
    version = 5,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun gpsFixDao(): GpsFixDao
    abstract fun pendingPhotoDao(): PendingPhotoDao
    abstract fun dispatchMessageDao(): DispatchMessageDao
    abstract fun activityEventDao(): ActivityEventDao

    companion object {
        /**
         * v1 contained GPS fixes only. Create the original v2 queue schema.
         */
        val MIGRATION_1_2: Migration = object : Migration(1, 2) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL(
                    """CREATE TABLE IF NOT EXISTS pending_photos (
                        eventUuid TEXT NOT NULL,
                        convoyId TEXT NOT NULL,
                        truckId TEXT NOT NULL,
                        session TEXT NOT NULL,
                        photoType TEXT NOT NULL,
                        sealPosition TEXT,
                        reportDate TEXT NOT NULL,
                        localFilePath TEXT NOT NULL,
                        lat REAL,
                        lng REAL,
                        notes TEXT,
                        createdAt INTEGER NOT NULL,
                        attempts INTEGER NOT NULL,
                        lastError TEXT,
                        PRIMARY KEY(eventUuid)
                    )"""
                )
            }
        }

        /**
         * v2 had no capture-time field. Rebuild the table so the added column
         * has the same schema as the v3 entity (no persistent SQL default).
         * A legacy timestamp remains explicitly unknown; ownerless rows are
         * preserved but are not automatically replayed after v4→v5.
         */
        val MIGRATION_2_3: Migration = object : Migration(2, 3) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL(
                    """CREATE TABLE pending_photos_new (
                        eventUuid TEXT NOT NULL,
                        convoyId TEXT NOT NULL,
                        truckId TEXT NOT NULL,
                        session TEXT NOT NULL,
                        photoType TEXT NOT NULL,
                        sealPosition TEXT,
                        reportDate TEXT NOT NULL,
                        localFilePath TEXT NOT NULL,
                        takenAt TEXT NOT NULL,
                        lat REAL,
                        lng REAL,
                        notes TEXT,
                        createdAt INTEGER NOT NULL,
                        attempts INTEGER NOT NULL,
                        lastError TEXT,
                        PRIMARY KEY(eventUuid)
                    )"""
                )
                database.execSQL(
                    """INSERT INTO pending_photos_new (
                        eventUuid, convoyId, truckId, session, photoType, sealPosition,
                        reportDate, localFilePath, takenAt, lat, lng, notes, createdAt,
                        attempts, lastError
                    )
                    SELECT eventUuid, convoyId, truckId, session, photoType, sealPosition,
                           reportDate, localFilePath, '', lat, lng, notes, createdAt,
                           attempts, lastError
                    FROM pending_photos"""
                )
                database.execSQL("DROP TABLE pending_photos")
                database.execSQL("ALTER TABLE pending_photos_new RENAME TO pending_photos")
            }
        }

        /** Add the two Room tables introduced by v4 without resetting GPS/photos. */
        val MIGRATION_3_4: Migration = object : Migration(3, 4) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL(
                    """CREATE TABLE IF NOT EXISTS dispatch_messages (
                        id TEXT NOT NULL,
                        kind TEXT NOT NULL,
                        text TEXT,
                        voiceUrl TEXT,
                        receivedAt INTEGER NOT NULL,
                        read INTEGER NOT NULL,
                        PRIMARY KEY(id)
                    )"""
                )
                database.execSQL(
                    """CREATE TABLE IF NOT EXISTS activity_events (
                        id TEXT NOT NULL,
                        kind TEXT NOT NULL,
                        title TEXT NOT NULL,
                        detail TEXT,
                        severity TEXT NOT NULL,
                        occurredAt INTEGER NOT NULL,
                        PRIMARY KEY(id)
                    )"""
                )
            }
        }

        /**
         * Additive migration: preserve every queued photo and mark historical
         * rows with an empty owner. They remain on disk but are not replayable
         * until an account-bound recovery procedure can safely attribute them.
         */
        val MIGRATION_4_5: Migration = object : Migration(4, 5) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL(
                    "ALTER TABLE pending_photos ADD COLUMN ownerUserId TEXT NOT NULL DEFAULT ''"
                )
            }
        }
    }
}
