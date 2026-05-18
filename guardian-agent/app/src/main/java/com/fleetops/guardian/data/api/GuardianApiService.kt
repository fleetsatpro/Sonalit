package com.fleetops.guardian.data.api

import com.google.gson.annotations.SerializedName
import retrofit2.Response
import retrofit2.http.*

interface GuardianApiService {

    @POST("guardian/enroll")
    suspend fun enroll(@Body body: EnrollRequest): EnrollResponse

    @POST("guardian/heartbeat")
    suspend fun heartbeat(
        @Header("X-Device-Token") token: String,
        @Body body: HeartbeatRequest
    ): HeartbeatResponse

    @POST("guardian/location")
    suspend fun sendLocation(
        @Header("X-Device-Token") token: String,
        @Body body: LocationRequest
    ): Response<Unit>

    @POST("guardian/panic")
    suspend fun triggerPanic(
        @Header("X-Device-Token") token: String,
        @Body body: PanicRequest
    ): PanicResponse

    @POST("guardian/report")
    suspend fun submitReport(
        @Header("X-Device-Token") token: String,
        @Body body: ReportRequest
    ): ReportResponse

    @POST("guardian/ack-command")
    suspend fun ackCommand(
        @Header("X-Device-Token") token: String,
        @Body body: AckRequest
    ): Response<Unit>

    @GET("guardian/cfo/context")
    suspend fun getCfoContext(
        @Header("X-Device-Token") token: String
    ): CfoContextResponse

    @POST("guardian/cfo/photo-upload-url")
    suspend fun getCfoPhotoUploadUrl(
        @Header("X-Device-Token") token: String,
        @Body body: CfoPhotoUploadUrlRequest
    ): CfoPhotoUploadUrlResponse

    @POST("guardian/cfo/photos")
    suspend fun commitCfoPhoto(
        @Header("X-Device-Token") token: String,
        @Body body: CfoPhotoCommitRequest
    ): Response<CfoPhotoCommitResponse>
}

// ─── Enrollment ───────────────────────────────────────────────────────────────

data class EnrollRequest(
    val orgToken: String,
    val deviceName: String,
    val imei: String,
    val androidId: String,
    val manufacturer: String,
    val model: String,
    val osVersion: String,
    val appVersion: String
)

data class EnrollResponse(
    @SerializedName("device_id") val deviceId: String,
    @SerializedName("device_token") val deviceToken: String,
    @SerializedName("tracking_mode") val trackingMode: String,
    @SerializedName("tracking_interval_seconds") val trackingIntervalSeconds: Int,
    @SerializedName("server_time") val serverTime: Long,
    val message: String?
)

// ─── Heartbeat ────────────────────────────────────────────────────────────────

data class HeartbeatRequest(
    @SerializedName("device_id") val deviceId: String,
    val timestamp: Long,
    @SerializedName("battery_level") val batteryLevel: Int,
    @SerializedName("battery_charging") val batteryCharging: Boolean,
    @SerializedName("signal_strength") val signalStrength: Int,
    @SerializedName("network_type") val networkType: String,
    @SerializedName("storage_free_m") val storageFreeM: Int,
    @SerializedName("ram_free_m") val ramFreeM: Int,
    val latitude: Double?,
    val longitude: Double?,
    @SerializedName("location_age") val locationAge: Long?,
    @SerializedName("app_version") val appVersion: String
)

data class HeartbeatResponse(
    val status: String,
    @SerializedName("server_time") val serverTime: Long,
    val commands: List<CommandDto>?,
    @SerializedName("new_tracking_mode") val newTrackingMode: String?,
    @SerializedName("new_tracking_interval_seconds") val newTrackingIntervalSeconds: Int?
)

// ─── Location ─────────────────────────────────────────────────────────────────

data class LocationRequest(
    @SerializedName("device_id") val deviceId: String,
    val latitude: Double,
    val longitude: Double,
    val altitude: Double?,
    val speed: Float?,
    val heading: Float?,
    val accuracy: Float?,
    val timestamp: Long,
    @SerializedName("tracking_mode") val trackingMode: String
)

// ─── Panic ────────────────────────────────────────────────────────────────────

data class PanicRequest(
    @SerializedName("device_id") val deviceId: String,
    @SerializedName("panic_mode") val panicMode: String,
    val message: String?,
    val latitude: Double?,
    val longitude: Double?,
    val timestamp: Long,
    @SerializedName("battery_level") val batteryLevel: Int,
    @SerializedName("network_type") val networkType: String
)

data class PanicResponse(
    val acknowledged: Boolean,
    @SerializedName("incident_id") val incidentId: String?,
    val instructions: String?,
    @SerializedName("callback_number") val callbackNumber: String?
)

// ─── Field Report ─────────────────────────────────────────────────────────────

data class ReportRequest(
    @SerializedName("device_id") val deviceId: String,
    val category: String,
    val description: String,
    val latitude: Double?,
    val longitude: Double?,
    val timestamp: Long,
    val attachments: List<String>?
)

data class ReportResponse(
    @SerializedName("report_id") val reportId: String,
    val acknowledged: Boolean,
    val message: String?
)

// ─── Command ──────────────────────────────────────────────────────────────────

data class AckRequest(
    @SerializedName("device_id") val deviceId: String,
    @SerializedName("command_id") val commandId: String,
    val status: String,
    val timestamp: Long
)

data class CommandDto(
    @SerializedName("command_id") val commandId: String,
    val type: String,
    val payload: Map<String, String>?,
    @SerializedName("issued_at") val issuedAt: Long,
    @SerializedName("expires_at") val expiresAt: Long?
)

// ─── CFO ──────────────────────────────────────────────────────────────────────

data class CfoTruckDto(
    val id: String,
    val position: Int,
    @SerializedName("vehicle_id") val vehicleId: String?,
    @SerializedName("driver_name") val driverName: String,
    @SerializedName("driver_phone") val driverPhone: String?
)

data class CfoPhotoDto(
    val id: String,
    @SerializedName("convoy_truck_id") val convoyTruckId: String,
    val session: String,
    @SerializedName("photo_type") val photoType: String,
    @SerializedName("seal_position") val sealPosition: String?,
    @SerializedName("taken_at") val takenAt: String
)

data class CfoConvoyDto(
    val id: String,
    val name: String,
    val status: String,
    val timezone: String,
    @SerializedName("start_date") val startDate: String?,
    @SerializedName("end_date") val endDate: String?,
    @SerializedName("seal_count_per_truck") val sealCountPerTruck: Int
)

data class CfoContextData(
    val convoy: CfoConvoyDto,
    @SerializedName("cfo_user_id") val cfoUserId: String,
    @SerializedName("assigned_trucks") val assignedTrucks: List<CfoTruckDto>,
    @SerializedName("report_date") val reportDate: String,
    @SerializedName("photos_today") val photosToday: List<CfoPhotoDto>
)

data class CfoContextResponse(val data: CfoContextData)

data class CfoPhotoUploadUrlRequest(
    @SerializedName("convoy_id") val convoyId: String,
    @SerializedName("convoy_truck_id") val convoyTruckId: String,
    val session: String,
    @SerializedName("photo_type") val photoType: String,
    @SerializedName("seal_position") val sealPosition: String?,
    @SerializedName("report_date") val reportDate: String
)

data class CfoPhotoUploadUrlResponse(
    @SerializedName("upload_url") val uploadUrl: String,
    @SerializedName("public_url") val publicUrl: String,
    val key: String
)

data class CfoPhotoCommitRequest(
    @SerializedName("event_uuid") val eventUuid: String,
    @SerializedName("convoy_id") val convoyId: String,
    @SerializedName("convoy_truck_id") val convoyTruckId: String,
    val session: String,
    @SerializedName("photo_type") val photoType: String,
    @SerializedName("seal_position") val sealPosition: String?,
    @SerializedName("report_date") val reportDate: String,
    @SerializedName("photo_url") val photoUrl: String,
    @SerializedName("taken_at") val takenAt: String,
    val lat: Double?,
    val lng: Double?,
    val notes: String?
)

data class CfoPhotoCommitResponse(
    val data: Map<String, Any?>,
    val duplicate: Boolean?
)
