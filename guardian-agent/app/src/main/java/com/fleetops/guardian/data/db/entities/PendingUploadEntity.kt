package com.fleetops.guardian.data.db.entities

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Represents an item in the offline upload queue.
 * When network is unavailable, events (locations, reports, panics) are
 * serialised as JSON and stored here for later flushing.
 */
@Entity(
    tableName = "pending_uploads",
    indices = [
        Index(value = ["type"]),
        Index(value = ["created_at"]),
        Index(value = ["attempts"])
    ]
)
data class PendingUploadEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    val id: Long = 0L,

    /** One of: "location", "report", "panic" */
    @ColumnInfo(name = "type")
    val type: String,

    /** JSON-serialised request body */
    @ColumnInfo(name = "payload")
    val payload: String,

    @ColumnInfo(name = "created_at")
    val createdAt: Long = System.currentTimeMillis(),

    /** How many upload attempts have been made — used to discard stale items */
    @ColumnInfo(name = "attempts", defaultValue = "0")
    val attempts: Int = 0,

    /** Timestamp of the last upload attempt */
    @ColumnInfo(name = "last_attempted_at")
    val lastAttemptedAt: Long? = null
) {
    companion object {
        const val TYPE_LOCATION = "location"
        const val TYPE_REPORT = "report"
        const val TYPE_PANIC = "panic"

        /** Discard items after this many failed attempts */
        const val MAX_ATTEMPTS = 10
    }
}
