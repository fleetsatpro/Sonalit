package io.sonalit.guardian.data.remote

import com.squareup.moshi.Json
import retrofit2.http.*

// ── Device API ────────────────────────────────────────────────────────────────

data class EnrollRequest(
    val device_id: String,
    val operator_code: String,
    val play_integrity_token: String,
    val platform: String = "android",
    val fcm_token: String? = null,
    val app_version: String? = null,
)
data class EnrollResponse(val status: String, val device_uuid: String, val device_token: String? = null)
data class HeartbeatRequest(val device_id: String, val battery_pct: Int? = null,
    val connectivity: String? = null, val lat: Double? = null, val lon: Double? = null)
data class HeartbeatResponse(val commands: List<Map<String, Any>>)
// Backend reads req.body.lng (POST /guardian/panic in guardian.js), not "lon" —
// unlike /guardian/heartbeat, this route has no legacy-field fallback, so every
// Android panic was silently sent with a longitude the server never read.
data class PanicRequest(val device_id: String, val mode: String, val lat: Double, @Json(name = "lng") val lon: Double,
    val event_uuid: String? = null, val driver_id: String? = null, val note: String? = null)
data class PanicResponse(val event_id: String, val status: String)
// Backend POST /guardian/location/batch reads req.body.points[].lng, not "lon"
// (see backend/src/routes/guardian.js processLocationBatch) — same lon/lng
// mismatch already fixed on PanicRequest above, mapped the same way here.
data class LocationPoint(
    val lat: Double,
    @Json(name = "lng") val lon: Double,
    val heading: Float? = null,
    val speed: Float? = null,
    @Json(name = "accuracy") val accuracyM: Float? = null,
    val timestamp: String,
)
data class LocationBatchRequest(val points: List<LocationPoint>)

// ── CFO API ───────────────────────────────────────────────────────────────────

data class CfoLoginRequest(val email: String, val password: String)
data class CfoLoginResponse(
    val user_id: String, val name: String, val email: String, val role: String,
    val device_token: String? = null,
)

data class AssignedTruck(
    val id: String,
    val plate_number: String?,
    val make: String?,
    val model: String?,
    val position: Int,
)

data class PhotoRecord(
    val id: String,
    val convoy_truck_id: String,
    val session: String,
    val photo_type: String,
    val seal_position: String?,
    val taken_at: String,
    val uploaded_at: String,
)

data class DailyReportStatus(
    val status: String,
    val received_photo_count: Int,
    val required_photo_count: Int,
    val generated_at: String?,
    val pdf_url: String?,
)

data class ConvoyInfo(
    val id: String,
    val name: String,
    val status: String,
    val timezone: String?,
    val start_date: String?,
    val end_date: String?,
    val seal_count_per_truck: Int,
)

data class CfoContextData(
    val convoy: ConvoyInfo,
    val cfo_user_id: String,
    val assigned_trucks: List<AssignedTruck>,
    val report_date: String,
    val today_date: String = report_date,
    val available_dates: List<String> = listOf(report_date),
    val photos_today: List<PhotoRecord>,
    val daily_report: DailyReportStatus?,
)
data class CfoContextResponse(val data: CfoContextData)

data class PhotoUploadUrlRequest(
    val convoy_id: String,
    val convoy_truck_id: String,
    val session: String,
    val photo_type: String,
    val seal_position: String?,
    val report_date: String,
)
data class PhotoUploadUrlResponse(val upload_url: String, val public_url: String, val key: String)

data class CommitPhotoRequest(
    val event_uuid: String,
    val convoy_id: String,
    val convoy_truck_id: String,
    val session: String,
    val photo_type: String,
    val seal_position: String?,
    val report_date: String,
    val photo_url: String,
    val taken_at: String,
    val lat: Double?,
    val lng: Double?,
    val notes: String?,
)

data class UpsertSealRequest(
    val convoy_id: String,
    val convoy_truck_id: String,
    val seal_position: String,
    val rfid_code: String,
    val session: String,
    val report_date: String,
    val status: String,
    val notes: String?,
    val photo_url: String?,
)

// ── Interface ─────────────────────────────────────────────────────────────────

interface GuardianApi {

    // Device endpoints
    @POST("guardian/enroll")
    suspend fun enroll(@Body req: EnrollRequest): EnrollResponse

    @POST("guardian/heartbeat")
    suspend fun heartbeat(@Body req: HeartbeatRequest): HeartbeatResponse

    @POST("guardian/panic")
    suspend fun panic(@Body req: PanicRequest): PanicResponse

    @POST("guardian/panic/cancel")
    suspend fun cancelPanic(): Map<String, Any>

    @POST("guardian/ack-command")
    suspend fun ackCommand(@Body body: Map<String, String>): Map<String, String>

    // Was "telemetry/batch" — a path no backend route ever matched, so every
    // background GPS sync 404'd and field officer positions never reached
    // the server. guardian/location/batch is the real, working endpoint.
    @POST("guardian/location/batch")
    suspend fun locationBatch(@Body batch: LocationBatchRequest): Map<String, Any>

    // CFO endpoints — all require X-Device-Token header
    @POST("guardian/cfo/login")
    suspend fun cfoLogin(
        @Header("X-Device-Token") deviceToken: String,
        @Body req: CfoLoginRequest,
    ): CfoLoginResponse

    @GET("guardian/cfo/context")
    suspend fun cfoContext(
        @Header("X-Device-Token") deviceToken: String,
        @Query("date") date: String?,
    ): CfoContextResponse

    @POST("guardian/cfo/photo-upload-url")
    suspend fun cfoPhotoUploadUrl(
        @Header("X-Device-Token") deviceToken: String,
        @Body req: PhotoUploadUrlRequest,
    ): PhotoUploadUrlResponse

    @POST("guardian/cfo/photos")
    suspend fun cfoCommitPhoto(
        @Header("X-Device-Token") deviceToken: String,
        @Body req: CommitPhotoRequest,
    ): Map<String, Any>
}
