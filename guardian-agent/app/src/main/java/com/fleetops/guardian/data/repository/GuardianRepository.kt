package com.fleetops.guardian.data.repository

import android.annotation.SuppressLint
import android.content.Context
import android.provider.Settings
import android.telephony.TelephonyManager
import com.fleetops.guardian.BuildConfig
import com.fleetops.guardian.data.api.*
import com.fleetops.guardian.data.db.dao.LocationDao
import com.fleetops.guardian.data.db.dao.PendingUploadDao
import com.fleetops.guardian.data.db.entities.LocationEntity
import com.fleetops.guardian.data.db.entities.PendingUploadEntity
import com.fleetops.guardian.data.prefs.DevicePrefs
import com.fleetops.guardian.util.batteryCharging
import com.fleetops.guardian.util.batteryLevel
import com.fleetops.guardian.util.networkType
import com.fleetops.guardian.util.ramFreeM
import com.fleetops.guardian.util.signalStrength
import com.fleetops.guardian.util.storageFreeM
import com.google.gson.Gson
import kotlinx.coroutines.channels.Channel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

enum class PanicMode(val apiValue: String) {
    SILENT("silent"),
    LOUD("loud"),
    MEDICAL("medical"),
    SECURITY("security"),
    HIJACK("hijack")
}

sealed class RepositoryResult<out T> {
    data class Success<T>(val data: T) : RepositoryResult<T>()
    data class Error(val message: String, val cause: Throwable? = null) : RepositoryResult<Nothing>()
}

@Singleton
class GuardianRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val devicePrefs: DevicePrefs,
    private val locationDao: LocationDao,
    private val pendingUploadDao: PendingUploadDao,
    private val gson: Gson
) {

    // Buffered channel — commands survive even when the service is not yet running.
    // Capacity.BUFFERED gives a 64-element buffer; the service drains it on startup.
    val commandChannel = Channel<CommandDto>(capacity = Channel.BUFFERED)

    // ─── Enrollment ───────────────────────────────────────────────────────────

    suspend fun enroll(
        serverUrl: String,
        orgToken: String,
        deviceName: String
    ): RepositoryResult<EnrollResponse> = withContext(Dispatchers.IO) {
        try {
            val api = RetrofitClient.buildApiService(serverUrl)

            val imei = getImei()
            val androidId = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ANDROID_ID
            ) ?: "unknown"

            val request = EnrollRequest(
                orgToken = orgToken,
                deviceName = deviceName,
                imei = imei,
                androidId = androidId,
                manufacturer = android.os.Build.MANUFACTURER,
                model = android.os.Build.MODEL,
                osVersion = android.os.Build.VERSION.RELEASE,
                appVersion = BuildConfig.VERSION_NAME
            )

            val response = api.enroll(request)

            devicePrefs.saveEnrollment(
                deviceId = response.deviceId,
                deviceToken = response.deviceToken,
                serverUrl = serverUrl,
                orgToken = orgToken,
                deviceName = deviceName,
                trackingMode = response.trackingMode ?: DevicePrefs.TrackingMode.NORMAL,
                trackingIntervalSeconds = response.trackingIntervalSeconds
            )

            RepositoryResult.Success(response)
        } catch (e: Exception) {
            RepositoryResult.Error(
                message = e.message ?: "Enrollment failed",
                cause = e
            )
        }
    }

    // ─── Heartbeat ────────────────────────────────────────────────────────────

    suspend fun sendHeartbeat(): RepositoryResult<HeartbeatResponse> = withContext(Dispatchers.IO) {
        try {
            val token = devicePrefs.deviceToken()
            val deviceId = devicePrefs.deviceId()
            val serverUrl = devicePrefs.serverUrl()

            if (token.isEmpty() || deviceId.isEmpty()) {
                return@withContext RepositoryResult.Error("Device not enrolled")
            }

            val api = RetrofitClient.buildApiService(serverUrl)

            val request = HeartbeatRequest(
                deviceId = deviceId,
                timestamp = System.currentTimeMillis(),
                batteryLevel = context.batteryLevel(),
                batteryCharging = context.batteryCharging(),
                signalStrength = context.signalStrength(),
                networkType = context.networkType(),
                storageFreeM = context.storageFreeM(),
                ramFreeM = context.ramFreeM(),
                latitude = null,   // optionally populated by service layer
                longitude = null,
                locationAge = null,
                appVersion = BuildConfig.VERSION_NAME
            )

            val response = api.heartbeat(token, request)

            devicePrefs.setLastHeartbeat(System.currentTimeMillis())

            // Buffer commands for the service to drain — trySend never blocks or throws
            response.commands?.forEach { command ->
                commandChannel.trySend(command)
            }

            // Apply config changes if server updated them
            response.newTrackingMode?.let { mode ->
                devicePrefs.setTrackingMode(mode)
            }
            response.newTrackingIntervalSeconds?.let { interval ->
                devicePrefs.setTrackingIntervalSeconds(interval)
            }

            RepositoryResult.Success(response)
        } catch (e: Exception) {
            RepositoryResult.Error(
                message = e.message ?: "Heartbeat failed",
                cause = e
            )
        }
    }

    // ─── Location ─────────────────────────────────────────────────────────────

    suspend fun sendLocation(
        lat: Double,
        lng: Double,
        altitude: Double?,
        speed: Float?,
        heading: Float?,
        accuracy: Float?
    ): RepositoryResult<Unit> = withContext(Dispatchers.IO) {
        val token = devicePrefs.deviceToken()
        val deviceId = devicePrefs.deviceId()
        val trackingMode = devicePrefs.trackingMode()
        val timestamp = System.currentTimeMillis()

        // Always cache to local DB first
        val entity = LocationEntity(
            deviceId = deviceId,
            lat = lat,
            lng = lng,
            altitude = altitude,
            heading = heading,
            speed = speed,
            accuracy = accuracy,
            timestamp = timestamp,
            synced = false,
            trackingMode = trackingMode
        )
        val insertedId = locationDao.insert(entity)

        devicePrefs.setLastLocation(lat, lng, timestamp)

        // Attempt live upload if online
        if (context.networkType() != "offline" && token.isNotEmpty() && deviceId.isNotEmpty()) {
            try {
                val serverUrl = devicePrefs.serverUrl()
                val api = RetrofitClient.buildApiService(serverUrl)

                val request = LocationRequest(
                    deviceId = deviceId,
                    latitude = lat,
                    longitude = lng,
                    altitude = altitude,
                    speed = speed,
                    heading = heading,
                    accuracy = accuracy,
                    timestamp = timestamp,
                    trackingMode = trackingMode
                )

                val response = api.sendLocation(token, request)
                if (response.isSuccessful) {
                    locationDao.markAsSynced(listOf(insertedId))
                    // Prune old synced entries (keep last 7 days)
                    val sevenDaysAgo = timestamp - (7L * 24 * 60 * 60 * 1000)
                    locationDao.deleteSyncedOlderThan(sevenDaysAgo)
                } else {
                    enqueuePendingLocation(deviceId, lat, lng, altitude, speed, heading, accuracy, timestamp, trackingMode)
                }
            } catch (e: Exception) {
                // Network error — already in DB, also add to pending queue
                enqueuePendingLocation(deviceId, lat, lng, altitude, speed, heading, accuracy, timestamp, trackingMode)
            }
        }

        RepositoryResult.Success(Unit)
    }

    private suspend fun enqueuePendingLocation(
        deviceId: String,
        lat: Double,
        lng: Double,
        altitude: Double?,
        speed: Float?,
        heading: Float?,
        accuracy: Float?,
        timestamp: Long,
        trackingMode: String
    ) {
        val request = LocationRequest(
            deviceId = deviceId,
            latitude = lat,
            longitude = lng,
            altitude = altitude,
            speed = speed,
            heading = heading,
            accuracy = accuracy,
            timestamp = timestamp,
            trackingMode = trackingMode
        )
        val payload = gson.toJson(request)
        pendingUploadDao.insert(
            PendingUploadEntity(
                type = PendingUploadEntity.TYPE_LOCATION,
                payload = payload,
                createdAt = System.currentTimeMillis()
            )
        )
    }

    // ─── Panic ────────────────────────────────────────────────────────────────

    suspend fun triggerPanic(
        mode: PanicMode,
        message: String?,
        lat: Double? = null,
        lng: Double? = null
    ): RepositoryResult<PanicResponse> = withContext(Dispatchers.IO) {
        val token = devicePrefs.deviceToken()
        val deviceId = devicePrefs.deviceId()
        val serverUrl = devicePrefs.serverUrl()

        val request = PanicRequest(
            deviceId = deviceId,
            panicMode = mode.apiValue,
            message = message,
            latitude = lat,
            longitude = lng,
            timestamp = System.currentTimeMillis(),
            batteryLevel = context.batteryLevel(),
            networkType = context.networkType()
        )

        // Attempt direct send with retries (retry logic is in OkHttp interceptor)
        if (token.isNotEmpty() && deviceId.isNotEmpty()) {
            try {
                val api = RetrofitClient.buildApiService(serverUrl)
                val response = api.triggerPanic(token, request)
                return@withContext RepositoryResult.Success(response)
            } catch (e: Exception) {
                // Fall through — cache and return error
                val payload = gson.toJson(request)
                pendingUploadDao.insert(
                    PendingUploadEntity(
                        type = PendingUploadEntity.TYPE_PANIC,
                        payload = payload,
                        createdAt = System.currentTimeMillis()
                    )
                )
                return@withContext RepositoryResult.Error(
                    message = "Panic queued — will send when connected",
                    cause = e
                )
            }
        }

        // Not enrolled — queue anyway
        val payload = gson.toJson(request)
        pendingUploadDao.insert(
            PendingUploadEntity(
                type = PendingUploadEntity.TYPE_PANIC,
                payload = payload,
                createdAt = System.currentTimeMillis()
            )
        )
        RepositoryResult.Error("Not enrolled — panic queued")
    }

    // ─── Report ───────────────────────────────────────────────────────────────

    suspend fun submitReport(
        category: String,
        description: String,
        lat: Double? = null,
        lng: Double? = null
    ): RepositoryResult<ReportResponse> = withContext(Dispatchers.IO) {
        val token = devicePrefs.deviceToken()
        val deviceId = devicePrefs.deviceId()
        val serverUrl = devicePrefs.serverUrl()

        val request = ReportRequest(
            deviceId = deviceId,
            category = category,
            description = description,
            latitude = lat,
            longitude = lng,
            timestamp = System.currentTimeMillis(),
            attachments = null
        )

        if (token.isNotEmpty() && deviceId.isNotEmpty() && context.networkType() != "offline") {
            try {
                val api = RetrofitClient.buildApiService(serverUrl)
                val response = api.submitReport(token, request)
                return@withContext RepositoryResult.Success(response)
            } catch (e: Exception) {
                val payload = gson.toJson(request)
                pendingUploadDao.insert(
                    PendingUploadEntity(
                        type = PendingUploadEntity.TYPE_REPORT,
                        payload = payload,
                        createdAt = System.currentTimeMillis()
                    )
                )
                return@withContext RepositoryResult.Error(
                    message = "Report queued — will send when connected",
                    cause = e
                )
            }
        }

        val payload = gson.toJson(request)
        pendingUploadDao.insert(
            PendingUploadEntity(
                type = PendingUploadEntity.TYPE_REPORT,
                payload = payload,
                createdAt = System.currentTimeMillis()
            )
        )
        RepositoryResult.Error("Offline — report queued")
    }

    // ─── Sync Pending Uploads ─────────────────────────────────────────────────

    suspend fun syncPendingUploads(): RepositoryResult<Int> = withContext(Dispatchers.IO) {
        if (context.networkType() == "offline") {
            return@withContext RepositoryResult.Error("No network")
        }

        val token = devicePrefs.deviceToken()
        val deviceId = devicePrefs.deviceId()
        val serverUrl = devicePrefs.serverUrl()

        if (token.isEmpty() || deviceId.isEmpty()) {
            return@withContext RepositoryResult.Error("Not enrolled")
        }

        // Clean up exhausted items first
        pendingUploadDao.deleteExhausted()

        val api = RetrofitClient.buildApiService(serverUrl)
        var successCount = 0
        val pending = pendingUploadDao.getPending(50)

        for (item in pending) {
            try {
                val uploaded = when (item.type) {
                    PendingUploadEntity.TYPE_LOCATION -> {
                        val req = gson.fromJson(item.payload, LocationRequest::class.java)
                        val resp = api.sendLocation(token, req)
                        resp.isSuccessful
                    }
                    PendingUploadEntity.TYPE_PANIC -> {
                        val req = gson.fromJson(item.payload, PanicRequest::class.java)
                        api.triggerPanic(token, req) // throws on failure
                        true
                    }
                    PendingUploadEntity.TYPE_REPORT -> {
                        val req = gson.fromJson(item.payload, ReportRequest::class.java)
                        api.submitReport(token, req) // throws on failure
                        true
                    }
                    else -> false
                }

                if (uploaded) {
                    pendingUploadDao.deleteById(item.id)
                    successCount++
                } else {
                    pendingUploadDao.incrementAttempts(item.id)
                }
            } catch (e: Exception) {
                pendingUploadDao.incrementAttempts(item.id)
                android.util.Log.w(TAG, "Failed to upload pending item ${item.id}: ${e.message}")
            }
        }

        // Also flush unsynced locations from the location table
        val unsynced = locationDao.getUnsynced(50)
        for (loc in unsynced) {
            try {
                val req = LocationRequest(
                    deviceId = loc.deviceId,
                    latitude = loc.lat,
                    longitude = loc.lng,
                    altitude = loc.altitude,
                    speed = loc.speed,
                    heading = loc.heading,
                    accuracy = loc.accuracy,
                    timestamp = loc.timestamp,
                    trackingMode = loc.trackingMode
                )
                val resp = api.sendLocation(token, req)
                if (resp.isSuccessful) {
                    locationDao.markAsSynced(listOf(loc.id))
                    successCount++
                }
            } catch (e: Exception) {
                android.util.Log.w(TAG, "Failed to sync location ${loc.id}: ${e.message}")
            }
        }

        RepositoryResult.Success(successCount)
    }

    // ─── Command Acknowledgement ──────────────────────────────────────────────

    suspend fun ackCommand(commandId: String, status: String = "executed") {
        try {
            val token = devicePrefs.deviceToken()
            val deviceId = devicePrefs.deviceId()
            val serverUrl = devicePrefs.serverUrl()
            if (token.isEmpty() || deviceId.isEmpty()) return

            val api = RetrofitClient.buildApiService(serverUrl)
            api.ackCommand(
                token,
                AckRequest(
                    deviceId = deviceId,
                    commandId = commandId,
                    status = status,
                    timestamp = System.currentTimeMillis()
                )
            )
        } catch (e: Exception) {
            android.util.Log.w(TAG, "Failed to ack command $commandId: ${e.message}")
        }
    }

    // ─── Dead Man's Switch ────────────────────────────────────────────────────

    suspend fun dmsCheckin(): RepositoryResult<com.fleetops.guardian.data.api.DmsCheckinResponse> =
        withContext(Dispatchers.IO) {
            try {
                val token = devicePrefs.deviceToken()
                val deviceId = devicePrefs.deviceId()
                val serverUrl = devicePrefs.serverUrl()
                val api = RetrofitClient.buildApiService(serverUrl)
                val response = api.dmsCheckin(
                    token,
                    com.fleetops.guardian.data.api.DmsCheckinRequest(
                        deviceId = deviceId,
                        timestamp = System.currentTimeMillis(),
                    )
                )
                if (response.isSuccessful && response.body() != null) {
                    RepositoryResult.Success(response.body()!!)
                } else {
                    RepositoryResult.Error("HTTP ${response.code()}")
                }
            } catch (e: Exception) {
                RepositoryResult.Error(e.message ?: "Unknown error", e)
            }
        }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    @SuppressLint("MissingPermission", "HardwareIds")
    private fun getImei(): String {
        return try {
            val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                tm.imei ?: tm.meid ?: "unknown"
            } else {
                @Suppress("DEPRECATION")
                tm.deviceId ?: "unknown"
            }
        } catch (e: Exception) {
            "unknown"
        }
    }

    companion object {
        private const val TAG = "GuardianRepository"
    }
}
