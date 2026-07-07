package io.sonalit.guardian.di

import android.content.Context
import androidx.room.Room
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import io.sonalit.guardian.data.local.AppDatabase
import io.sonalit.guardian.data.local.PendingPhotoDao
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides @Singleton
    fun provideDatabase(@ApplicationContext context: Context): AppDatabase =
        Room.databaseBuilder(context, AppDatabase::class.java, "guardian.db")
            .fallbackToDestructiveMigration()
            .build()

    @Provides @Singleton
    fun providePendingPhotoDao(db: AppDatabase): PendingPhotoDao = db.pendingPhotoDao()
}
