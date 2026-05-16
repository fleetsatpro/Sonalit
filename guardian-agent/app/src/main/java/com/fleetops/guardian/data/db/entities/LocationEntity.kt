package com.fleetops.guardian.data.db.entities

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "locations",
    indices = [
        Index(value = ["synced"]),
        Index(value = ["timestamp"])
    ]
)
data class LocationEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    val id: Long = 0L,

    @ColumnInfo(name = "device_id")
    val deviceId: String,

    @ColumnInfo(name = "lat")
    val lat: Double,

    @ColumnInfo(name = "lng")
    val lng: Double,

    @ColumnInfo(name = "altitude")
    val altitude: Double?,

    @ColumnInfo(name = "heading")
    val heading: Float?,

    @ColumnInfo(name = "speed")
    val speed: Float?,

    @ColumnInfo(name = "accuracy")
    val accuracy: Float?,

    @ColumnInfo(name = "timestamp")
    val timestamp: Long,

    @ColumnInfo(name = "synced", defaultValue = "0")
    val synced: Boolean = false,

    @ColumnInfo(name = "tracking_mode")
    val trackingMode: String = "normal"
)
