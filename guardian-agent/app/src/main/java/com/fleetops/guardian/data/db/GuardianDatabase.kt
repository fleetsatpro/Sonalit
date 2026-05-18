package com.fleetops.guardian.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import com.fleetops.guardian.data.db.dao.LocationDao
import com.fleetops.guardian.data.db.dao.PendingUploadDao
import com.fleetops.guardian.data.db.entities.LocationEntity
import com.fleetops.guardian.data.db.entities.PendingUploadEntity

@Database(
    entities = [
        LocationEntity::class,
        PendingUploadEntity::class
    ],
    version = 1,
    exportSchema = false
)
abstract class GuardianDatabase : RoomDatabase() {

    abstract fun locationDao(): LocationDao
    abstract fun pendingUploadDao(): PendingUploadDao

    companion object {
        private const val DATABASE_NAME = "guardian_db"

        @Volatile
        private var instance: GuardianDatabase? = null

        fun getInstance(context: Context): GuardianDatabase =
            instance ?: synchronized(this) {
                instance ?: buildDatabase(context).also { instance = it }
            }

        private fun buildDatabase(context: Context): GuardianDatabase =
            Room.databaseBuilder(
                context.applicationContext,
                GuardianDatabase::class.java,
                DATABASE_NAME
            )
                .fallbackToDestructiveMigration()
                .build()
    }
}
