package io.sonalit.guardian.data.local

import androidx.room.*

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
)

@Dao
interface PendingPhotoDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(photo: PendingPhotoEntity)

    @Query("SELECT * FROM pending_photos ORDER BY createdAt ASC")
    suspend fun getAll(): List<PendingPhotoEntity>

    @Query("SELECT * FROM pending_photos WHERE attempts < 5 ORDER BY createdAt ASC LIMIT 10")
    suspend fun getPending(): List<PendingPhotoEntity>

    @Query("UPDATE pending_photos SET attempts = attempts + 1, lastError = :err WHERE eventUuid = :id")
    suspend fun incrementAttempt(id: String, err: String)

    @Query("DELETE FROM pending_photos WHERE eventUuid = :id")
    suspend fun delete(id: String)

    @Query("SELECT COUNT(*) FROM pending_photos")
    suspend fun count(): Int
}

// ── Database ──────────────────────────────────────────────────────────────────

@Database(
    entities = [GpsFixEntity::class, PendingPhotoEntity::class],
    version = 3,
    exportSchema = false,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun gpsFixDao(): GpsFixDao
    abstract fun pendingPhotoDao(): PendingPhotoDao
}
