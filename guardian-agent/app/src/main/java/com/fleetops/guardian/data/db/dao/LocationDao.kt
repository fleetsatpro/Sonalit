package com.fleetops.guardian.data.db.dao

import androidx.room.*
import com.fleetops.guardian.data.db.entities.LocationEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface LocationDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(location: LocationEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(locations: List<LocationEntity>)

    @Update
    suspend fun update(location: LocationEntity)

    @Delete
    suspend fun delete(location: LocationEntity)

    @Query("SELECT * FROM locations WHERE synced = 0 ORDER BY timestamp ASC LIMIT :limit")
    suspend fun getUnsynced(limit: Int = 50): List<LocationEntity>

    @Query("SELECT * FROM locations ORDER BY timestamp DESC LIMIT :limit")
    suspend fun getRecent(limit: Int = 100): List<LocationEntity>

    @Query("SELECT * FROM locations WHERE id = :id")
    suspend fun getById(id: Long): LocationEntity?

    @Query("UPDATE locations SET synced = 1 WHERE id IN (:ids)")
    suspend fun markAsSynced(ids: List<Long>)

    @Query("DELETE FROM locations WHERE synced = 1 AND timestamp < :olderThan")
    suspend fun deleteSyncedOlderThan(olderThan: Long)

    @Query("SELECT COUNT(*) FROM locations WHERE synced = 0")
    fun unsyncedCountFlow(): Flow<Int>

    @Query("SELECT COUNT(*) FROM locations WHERE synced = 0")
    suspend fun unsyncedCount(): Int

    @Query("SELECT * FROM locations ORDER BY timestamp DESC")
    fun allLocationsFlow(): Flow<List<LocationEntity>>

    @Query("DELETE FROM locations")
    suspend fun deleteAll()
}
