package io.sonalit.guardian.data.remote

import com.squareup.moshi.Json
import okhttp3.RequestBody
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
data class RecoverRequest(val device_id: String)
data class HeartbeatRequest(val device_id: String, val battery_pct: Int? = null,
    val connectivity: String? = null, val lat: Double? = null, val lon: Double? = null,
    // Without this the server only ever learns the FCM token at enrollment —
    // when Firebase usually hasn't issued one yet — leaving guardian_devices.
    // fcm_token NULL forever and every command push silently skipped.
    val fcm_token: String? = null)
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

data class VoiceMessageUploadResponseData(val voice_id: String, val status: String)
data class VoiceMessageUploadResponse(val data: VoiceMessageUploadResponseData)

data class ConvoyMember(
    val id: String,
    val name: String,
    val last_lat: Double?,
    val last_lng: Double?,
    val last_speed: Double?,
    val last_seen: String?,
    val status: String?,
)
data class ConvoyStatusResponse(
    val in_convoy: Boolean,
    val convoy_code: String?,
    val members: List<ConvoyMember> = emptyList(),
)

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
data class CapturePhotoUrlResponse(val upload_url: String, val public_url: String, val key: String)

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

    /** Silent identity recovery by ANDROID_ID — a reinstalled app on known
     *  hardware gets its device identity back without re-enrolling. */
    @POST("guardian/recover")
    suspend fun recover(@Body req: RecoverRequest): EnrollResponse

    @POST("guardian/heartbeat")
    suspend fun heartbeat(@Body req: HeartbeatRequest): HeartbeatResponse

    @POST("guardian/panic")
    suspend fun panic(@Body req: PanicRequest): PanicResponse

    @POST("guardian/panic/cancel")
    suspend fun cancelPanic(): Map<String, Any>

    /** Resets the server-side Dead Man's Switch timer (last_checkin_at). Sent
     *  while the device is alive so the server only escalates to a silent SOS
     *  once check-ins actually stop (device dark past its DMS timeout). */
    @POST("guardian/checkin")
    suspend fun checkin(): Map<String, Any>

    /** Presigns a one-shot R2 PUT for a capture_photo command (the covert
     *  "remote eyes" Knox substitute). Device-token auth via the interceptor. */
    @POST("guardian/capture-photo-url")
    suspend fun capturePhotoUrl(): CapturePhotoUrlResponse

    /** Reports a completed capture so dispatch sees it in Live Fleet.
     *  Body: { public_url, key, command_id? }. */
    @POST("guardian/capture-photo")
    suspend fun capturePhoto(@Body body: Map<String, String>): Map<String, Any>

    @POST("guardian/ack-command")
    suspend fun ackCommand(@Body body: Map<String, String>): Map<String, String>

    /** 60s in-service pickup — same claim as the heartbeat, minus telemetry. */
    @POST("guardian/commands/poll")
    suspend fun pollCommands(): HeartbeatResponse

    // Was "telemetry/batch" — a path no backend route ever matched, so every
    // background GPS sync 404'd and field officer positions never reached
    // the server. guardian/location/batch is the real, working endpoint.
    @POST("guardian/location/batch")
    suspend fun locationBatch(@Body batch: LocationBatchRequest): Map<String, Any>

    /** Field officer -> dispatch voice note. Body is raw audio bytes (see
     *  CommandExecutor's replayVoiceMessage for the reverse/download side) —
     *  X-Device-Token is injected by NetworkModule's interceptor like every
     *  other plain device endpoint here, so no explicit header param. */
    @POST("guardian/voice-message")
    suspend fun uploadVoiceMessage(
        @Body body: RequestBody,
        @Query("duration_ms") durationMs: Int,
    ): VoiceMessageUploadResponse

    /** Other Guardian devices sharing this device's ad-hoc convoy_code, with
     *  their last known position/status — backs the Home "My Convoy" card. */
    @GET("guardian/convoy")
    suspend fun convoyStatus(): ConvoyStatusResponse

    /** Org-wide device config (guardian_config table) — currently only used
     *  for dispatch_phone_number (Home's Call Dispatch button). Untyped
     *  because the table is a generic key/value store the backend flattens
     *  into a single JSON object. */
    @GET("guardian/config")
    suspend fun config(): Map<String, Any>

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
