package com.fleetops.guardian.data.api

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
}

// ─── Request / Response Data Classes ──────────────────────────────────────────

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
    val deviceId: String,
    val deviceToken: String,
    val trackingMode: String,
    val trackingIntervalSeconds: Int,
    val serverTime: Long,
    val message: String?
)

data class HeartbeatRequest(
    val deviceId: String,
    val timestamp: Long,
    val batteryLevel: Int,
    val batteryCharging: Boolean,
    val signalStrength: Int,
    val networkType: String,
    val storageFreeM: Int,
    val ramFreeM: Int,
    val latitude: Double?,
    val longitude: Double?,
    val locationAge: Long?,
    val appVersion: String
)

data class HeartbeatResponse(
    val status: String,
    val serverTime: Long,
    val commands: List<CommandDto>?,
    val newTrackingMode: String?,
    val newTrackingIntervalSeconds: Int?
)

data class LocationRequest(
    val deviceId: String,
    val latitude: Double,
    val longitude: Double,
    val altitude: Double?,
    val speed: Float?,
    val heading: Float?,
    val accuracy: Float?,
    val timestamp: Long,
    val trackingMode: String
)

data class PanicRequest(
    val deviceId: String,
    val panicMode: String,
    val message: String?,
    val latitude: Double?,
    val longitude: Double?,
    val timestamp: Long,
    val batteryLevel: Int,
    val networkType: String
)

data class PanicResponse(
    val acknowledged: Boolean,
    val incidentId: String?,
    val instructions: String?,
    val callbackNumber: String?
)

data class ReportRequest(
    val deviceId: String,
    val category: String,
    val description: String,
    val latitude: Double?,
    val longitude: Double?,
    val timestamp: Long,
    val attachments: List<String>?
)

data class ReportResponse(
    val reportId: String,
    val acknowledged: Boolean,
    val message: String?
)

data class AckRequest(
    val deviceId: String,
    val commandId: String,
    val status: String,
    val timestamp: Long
)

data class CommandDto(
    val commandId: String,
    val type: String,       // "lock_screen", "push_message", "update_config", "reboot", "wipe"
    val payload: Map<String, String>?,
    val issuedAt: Long,
    val expiresAt: Long?
)
