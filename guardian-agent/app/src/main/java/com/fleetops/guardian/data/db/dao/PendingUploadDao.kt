package com.fleetops.guardian.data.db.dao

import androidx.room.*
import com.fleetops.guardian.data.db.entities.PendingUploadEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface PendingUploadDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(item: PendingUploadEntity): Long

    @Update
    suspend fun update(item: PendingUploadEntity)

    @Delete
    suspend fun delete(item: PendingUploadEntity)

    @Query("SELECT * FROM pending_uploads ORDER BY created_at ASC LIMIT :limit")
    suspend fun getPending(limit: Int = 20): List<PendingUploadEntity>

    @Query("SELECT * FROM pending_uploads WHERE type = :type ORDER BY created_at ASC LIMIT :limit")
    suspend fun getPendingByType(type: String, limit: Int = 20): List<PendingUploadEntity>

    @Query("DELETE FROM pending_uploads WHERE id = :id")
    suspend fun deleteById(id: Long)

    @Query("DELETE FROM pending_uploads WHERE attempts >= :maxAttempts")
    suspend fun deleteExhausted(maxAttempts: Int = PendingUploadEntity.MAX_ATTEMPTS)

    @Query("UPDATE pending_uploads SET attempts = attempts + 1, last_attempted_at = :now WHERE id = :id")
    suspend fun incrementAttempts(id: Long, now: Long = System.currentTimeMillis())

    @Query("SELECT COUNT(*) FROM pending_uploads")
    suspend fun count(): Int

    @Query("SELECT COUNT(*) FROM pending_uploads")
    fun countFlow(): Flow<Int>

    @Query("SELECT * FROM pending_uploads WHERE type = :type ORDER BY created_at ASC")
    fun pendingByTypeFlow(type: String): Flow<List<PendingUploadEntity>>

    @Query("DELETE FROM pending_uploads WHERE created_at < :olderThan")
    suspend fun deleteOlderThan(olderThan: Long)

    @Query("DELETE FROM pending_uploads")
    suspend fun deleteAll()
}
