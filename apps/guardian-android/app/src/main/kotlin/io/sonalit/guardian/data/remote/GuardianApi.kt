package io.sonalit.guardian.data.remote

import retrofit2.http.*

data class EnrollRequest(val device_id: String, val operator_code: String, val play_integrity_token: String, val platform: String = "android", val fcm_token: String? = null, val app_version: String? = null)
data class EnrollResponse(val status: String, val device_uuid: String)
data class HeartbeatRequest(val device_id: String, val battery_pct: Int? = null, val connectivity: String? = null, val lat: Double? = null, val lon: Double? = null)
data class HeartbeatResponse(val commands: List<Map<String, Any>>)
data class PanicRequest(val device_id: String, val lat: Double, val lon: Double, val driver_id: String? = null, val note: String? = null)
data class PanicResponse(val event_id: String, val status: String)
data class GpsFixDto(val lat: Double, val lon: Double, val speed_kmh: Float, val heading: Float, val accuracy_m: Float, val ts: Long)
data class TelemetryBatch(val device_id: String, val fixes: List<GpsFixDto>)

interface GuardianApi {
    @POST("guardian/enroll")
    suspend fun enroll(@Body req: EnrollRequest): EnrollResponse

    @POST("guardian/heartbeat")
    suspend fun heartbeat(@Body req: HeartbeatRequest): HeartbeatResponse

    @POST("guardian/panic")
    suspend fun panic(@Body req: PanicRequest): PanicResponse

    @POST("guardian/ack-command")
    suspend fun ackCommand(@Body body: Map<String, String>): Map<String, String>

    @POST("telemetry/batch")
    suspend fun telemetryBatch(@Body batch: TelemetryBatch): Map<String, Any>

    @POST("media/photo-upload-url")
    suspend fun photoUploadUrl(@Body body: Map<String, String>): Map<String, String>

    @POST("media/photos/commit")
    suspend fun photosCommit(@Body body: Map<String, String>): Map<String, Any>
}
