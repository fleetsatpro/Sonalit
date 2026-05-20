package io.sonalit.guardian.data.local

import androidx.room.*

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

    @Query("UPDATE gps_fixes SET synced = 1 WHERE id IN (:ids)")
    suspend fun markSynced(ids: List<String>)

    @Query("DELETE FROM gps_fixes WHERE synced = 1 AND ts < :cutoffMs")
    suspend fun pruneOld(cutoffMs: Long)
}

@Database(entities = [GpsFixEntity::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun gpsFixDao(): GpsFixDao
}
