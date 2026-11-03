package com.fleetops.guardian.di

import android.content.Context
import com.fleetops.guardian.data.db.GuardianDatabase
import com.fleetops.guardian.data.db.dao.LocationDao
import com.fleetops.guardian.data.db.dao.PendingUploadDao
import com.fleetops.guardian.data.prefs.DevicePrefs
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideGuardianDatabase(@ApplicationContext context: Context): GuardianDatabase =
        GuardianDatabase.getInstance(context)

    @Provides
    @Singleton
    fun provideLocationDao(database: GuardianDatabase): LocationDao =
        database.locationDao()

    @Provides
    @Singleton
    fun providePendingUploadDao(database: GuardianDatabase): PendingUploadDao =
        database.pendingUploadDao()

    @Provides
    @Singleton
    fun provideDevicePrefs(@ApplicationContext context: Context): DevicePrefs =
        DevicePrefs(context)

    @Provides
    @Singleton
    fun provideGson(): Gson = GsonBuilder()
        .serializeNulls()
        .setDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
        .create()
}
