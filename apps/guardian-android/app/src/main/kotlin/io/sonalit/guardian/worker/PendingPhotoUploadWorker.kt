package io.sonalit.guardian.worker

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import androidx.work.*
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import io.sonalit.guardian.data.local.AppDatabase
import io.sonalit.guardian.data.local.PendingPhotoEntity
import io.sonalit.guardian.data.remote.CommitPhotoRequest
import io.sonalit.guardian.data.remote.GuardianApi
import io.sonalit.guardian.data.remote.PhotoUploadUrlRequest
import java.io.File
import java.util.concurrent.TimeUnit
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody

/**
 * Retries photo uploads that CfoViewModel.uploadPhoto() queued locally after a
 * failed presign/PUT/commit attempt. The pending_photos table (attempts,
 * lastError, getPending()) existed with nothing ever consuming it — photos
 * that failed once stayed queued forever with no way to reach the server.
 */
@HiltWorker
class PendingPhotoUploadWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val db: AppDatabase,
    private val api: GuardianApi,
    private val okHttp: OkHttpClient,
) : CoroutineWorker(context, params) {

    private fun deviceToken(): String = try {
        val masterKey = MasterKey.Builder(applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        val prefs = EncryptedSharedPreferences.create(
            applicationContext, "guardian_prefs", masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
        prefs.getString("auth_token", null) ?: ""
    } catch (_: Exception) {
        ""
    }

    override suspend fun doWork(): Result {
        val dao = db.pendingPhotoDao()
        val pending = dao.getPending()
        if (pending.isEmpty()) return Result.success()

        val token = deviceToken()
        if (token.isEmpty()) return Result.retry()

        var anyFailed = false
        for (p in pending) {
            try {
                uploadOne(token, p)
                dao.delete(p.eventUuid)
                File(p.localFilePath).delete()
            } catch (e: Exception) {
                anyFailed = true
                dao.incrementAttempt(p.eventUuid, e.message ?: "unknown error")
            }
        }
        return if (anyFailed) Result.retry() else Result.success()
    }

    private suspend fun uploadOne(token: String, p: PendingPhotoEntity) {
        val file = File(p.localFilePath)
        if (!file.exists()) throw IllegalStateException("local file missing")

        val urlResp = api.cfoPhotoUploadUrl(
            token,
            PhotoUploadUrlRequest(
                convoy_id = p.convoyId,
                convoy_truck_id = p.truckId,
                session = p.session,
                photo_type = p.photoType,
                seal_position = p.sealPosition,
                report_date = p.reportDate,
            ),
        )

        val putRequest = Request.Builder()
            .url(urlResp.upload_url)
            .put(file.asRequestBody("image/jpeg".toMediaType()))
            .build()
        okHttp.newCall(putRequest).execute().use { resp ->
            if (!resp.isSuccessful) error("Upload failed: ${resp.code}")
        }

        api.cfoCommitPhoto(
            token,
            CommitPhotoRequest(
                event_uuid = p.eventUuid,
                convoy_id = p.convoyId,
                convoy_truck_id = p.truckId,
                session = p.session,
                photo_type = p.photoType,
                seal_position = p.sealPosition,
                report_date = p.reportDate,
                photo_url = urlResp.public_url,
                taken_at = p.takenAt,
                lat = p.lat,
                lng = p.lng,
                notes = p.notes,
            ),
        )
    }

    companion object {
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<PendingPhotoUploadWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "pending_photo_upload", ExistingPeriodicWorkPolicy.KEEP, request,
            )
        }

        /** Runs the retry pass immediately — used by the Settings "Retry Now" action. */
        fun retryNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<PendingPhotoUploadWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                "pending_photo_upload_retry_now", ExistingWorkPolicy.REPLACE, request,
            )
        }
    }
}
