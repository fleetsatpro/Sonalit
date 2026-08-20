package io.sonalit.guardian.ui.cfo

import android.content.Context
import android.content.SharedPreferences
import android.location.Location
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import io.sonalit.guardian.data.local.PendingPhotoDao
import io.sonalit.guardian.data.local.PendingPhotoEntity
import io.sonalit.guardian.data.remote.*
import io.sonalit.guardian.worker.PendingPhotoUploadWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import java.text.SimpleDateFormat
import java.util.*
import javax.inject.Inject

// ── State ─────────────────────────────────────────────────────────────────────

enum class CfoNavScreen { LOGIN, DASHBOARD, SOD, EOD, SEALS, HISTORY, HANDOVER }

data class UploadState(
    val eventUuid: String,
    val truckId: String,
    val session: String,
    val photoType: String,
    val sealPosition: String?,
    val status: UploadStatus,
    val error: String? = null,
)
enum class UploadStatus { QUEUED, UPLOADING, DONE, FAILED }

data class CfoUiState(
    val screen: CfoNavScreen = CfoNavScreen.LOGIN,
    val loginLoading: Boolean = false,
    val loginError: String? = null,
    val loggedInUser: CfoLoginResponse? = null,
    val contextLoading: Boolean = false,
    val contextError: String? = null,
    val context: CfoContextData? = null,
    val selectedDate: String? = null,
    val lastRefreshedAt: Long? = null,
    val selectedTruckId: String? = null,
    val uploads: List<UploadState> = emptyList(),
    val pendingCount: Int = 0,
    val handoverUploading: Boolean = false,
    val handoverError: String? = null,
    // Set directly from a handover commit's convoy_completed flag — the
    // convoy's status flips server-side the instant this succeeds, but
    // /context excludes 'completed' convoys, so a subsequent poll would just
    // 404 rather than confirm it. This is the dashboard's only source of
    // truth for "the convoy just ended".
    val convoyEnded: Boolean = false,
) {
    /** True when browsing a past report_date rather than the live convoy day. */
    val isViewingHistory: Boolean
        get() = context != null && selectedDate != null && selectedDate != context.today_date
}

// ── ViewModel ─────────────────────────────────────────────────────────────────

@HiltViewModel
class CfoViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val api: GuardianApi,
    private val okHttp: OkHttpClient,
    private val pendingPhotoDao: PendingPhotoDao,
) : ViewModel() {

    private val _state = MutableStateFlow(CfoUiState())
    val state: StateFlow<CfoUiState> = _state.asStateFlow()

    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(appContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            appContext, "guardian_prefs", masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    private val deviceToken get() = prefs.getString("auth_token", null) ?: ""

    init {
        val savedUserId = prefs.getString("cfo_user_id", null)
        val savedName = prefs.getString("cfo_name", null)
        val savedEmail = prefs.getString("cfo_email", null)
        if (savedUserId != null && savedName != null && savedEmail != null) {
            _state.update {
                it.copy(
                    screen = CfoNavScreen.DASHBOARD,
                    loggedInUser = CfoLoginResponse(savedUserId, savedName, savedEmail, "cfo"),
                )
            }
            loadContext()
        }
        refreshPendingCount()
        // Resume any photos queued from a previous session/app-restart — schedule()
        // is a no-op if a worker is already enqueued (ExistingPeriodicWorkPolicy.KEEP).
        PendingPhotoUploadWorker.schedule(appContext)
        startAutoRefresh()
    }

    // Keeps the dashboard current without the CFO having to pull-to-refresh —
    // convoy photo counts change as other officers upload throughout the day.
    private fun startAutoRefresh() {
        viewModelScope.launch {
            while (isActive) {
                delay(30_000)
                val s = _state.value
                if (s.loggedInUser != null && s.screen != CfoNavScreen.LOGIN && !s.contextLoading && !s.convoyEnded) {
                    loadContext(s.selectedDate)
                }
            }
        }
    }

    // ── Auth ──────────────────────────────────────────────────────────────────

    fun login(email: String, password: String) {
        if (email.isBlank() || password.isBlank()) return
        _state.update { it.copy(loginLoading = true, loginError = null) }
        viewModelScope.launch {
            runCatching {
                api.cfoLogin(deviceToken, CfoLoginRequest(email.trim().lowercase(), password))
            }.onSuccess { resp ->
                val editor = prefs.edit()
                    .putString("cfo_user_id", resp.user_id)
                    .putString("cfo_name", resp.name)
                    .putString("cfo_email", resp.email)
                if (resp.device_token != null) {
                    editor.putString("auth_token", resp.device_token)
                }
                editor.apply()
                _state.update {
                    it.copy(loginLoading = false, loggedInUser = resp, screen = CfoNavScreen.DASHBOARD)
                }
                loadContext()
            }.onFailure { e ->
                _state.update { it.copy(loginLoading = false, loginError = e.message ?: "Login failed") }
            }
        }
    }

    fun logout() {
        prefs.edit().remove("cfo_user_id").remove("cfo_name").remove("cfo_email").apply()
        _state.update { CfoUiState() }
    }

    // ── Context ───────────────────────────────────────────────────────────────

    fun loadContext(date: String? = null) {
        _state.update { it.copy(contextLoading = true, contextError = null) }
        viewModelScope.launch {
            runCatching {
                api.cfoContext(deviceToken, date)
            }.onSuccess { resp ->
                _state.update {
                    it.copy(
                        contextLoading = false,
                        context = resp.data,
                        selectedDate = date ?: resp.data.report_date,
                        lastRefreshedAt = System.currentTimeMillis(),
                    )
                }
            }.onFailure { e ->
                _state.update { it.copy(contextLoading = false, contextError = e.message) }
            }
        }
    }

    /** CFO picked a date from the dashboard's date picker — reloads that day's data. */
    fun selectDate(date: String) {
        if (date == _state.value.selectedDate) return
        loadContext(date)
    }

    // ── Navigation ────────────────────────────────────────────────────────────

    fun navigate(screen: CfoNavScreen, truckId: String? = null) {
        _state.update { it.copy(screen = screen, selectedTruckId = truckId ?: it.selectedTruckId) }
    }

    fun selectTruck(truckId: String) {
        _state.update { it.copy(selectedTruckId = truckId) }
    }

    // ── Photo upload ──────────────────────────────────────────────────────────

    fun uploadPhoto(
        file: File,
        truckId: String,
        session: String,
        photoType: String,
        sealPosition: String?,
        location: Location?,
        eventUuid: String = UUID.randomUUID().toString(),
    ) {
        val ctx = _state.value.context ?: return
        // Uploads always target the live convoy day, even while the CFO is
        // browsing a past date's history in the dashboard.
        val uploadDate = ctx.today_date
        val takenAt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date())

        _state.update {
            it.copy(uploads = it.uploads + UploadState(
                eventUuid, truckId, session, photoType, sealPosition, UploadStatus.UPLOADING
            ))
        }

        viewModelScope.launch {
            runCatching {
                // Step 1: get presigned URL
                val urlResp = api.cfoPhotoUploadUrl(
                    deviceToken,
                    PhotoUploadUrlRequest(
                        convoy_id = ctx.convoy.id,
                        convoy_truck_id = truckId,
                        session = session,
                        photo_type = photoType,
                        seal_position = sealPosition,
                        report_date = uploadDate,
                    )
                )

                // Step 2: PUT photo to presigned URL
                val putRequest = Request.Builder()
                    .url(urlResp.upload_url)
                    .put(file.asRequestBody("image/jpeg".toMediaType()))
                    .build()
                withContext(Dispatchers.IO) {
                    okHttp.newCall(putRequest).execute().use { resp ->
                        if (!resp.isSuccessful) error("Upload failed: ${resp.code}")
                    }
                }

                // Step 3: commit photo record
                api.cfoCommitPhoto(
                    deviceToken,
                    CommitPhotoRequest(
                        event_uuid = eventUuid,
                        convoy_id = ctx.convoy.id,
                        convoy_truck_id = truckId,
                        session = session,
                        photo_type = photoType,
                        seal_position = sealPosition,
                        report_date = uploadDate,
                        photo_url = urlResp.public_url,
                        taken_at = takenAt,
                        lat = location?.latitude,
                        lng = location?.longitude,
                        notes = null,
                    )
                )
                urlResp.public_url
            }.onSuccess { _ ->
                _state.update {
                    it.copy(
                        uploads = it.uploads.map { u ->
                            if (u.eventUuid == eventUuid) u.copy(status = UploadStatus.DONE) else u
                        }
                    )
                }
                loadContext(_state.value.selectedDate)
            }.onFailure { e ->
                Log.w("CfoViewModel", "Upload failed for $eventUuid, queuing offline: ${e.message}")
                pendingPhotoDao.insert(
                    PendingPhotoEntity(
                        eventUuid = eventUuid,
                        convoyId = ctx.convoy.id,
                        truckId = truckId,
                        session = session,
                        photoType = photoType,
                        sealPosition = sealPosition,
                        reportDate = uploadDate,
                        localFilePath = file.absolutePath,
                        takenAt = takenAt,
                        lat = location?.latitude,
                        lng = location?.longitude,
                        notes = null,
                        createdAt = System.currentTimeMillis(),
                    )
                )
                PendingPhotoUploadWorker.schedule(appContext)
                _state.update {
                    it.copy(
                        uploads = it.uploads.map { u ->
                            if (u.eventUuid == eventUuid) u.copy(
                                status = UploadStatus.QUEUED,
                                error = e.message
                            ) else u
                        },
                        pendingCount = it.pendingCount + 1,
                    )
                }
            }
        }
    }

    fun clearUploadHistory() {
        _state.update { it.copy(uploads = it.uploads.filter { u -> u.status != UploadStatus.DONE }) }
    }

    // ── Handover (local_consignment convoys only) ────────────────────────────

    /** Uploads the handover form and, on success, ends the convoy client-side —
     *  see CfoUiState.convoyEnded. No offline queue here: unlike routine field
     *  photos, this is a single deliberate action the CFO performs once, in
     *  hand, at the end of the day — worth surfacing a failure immediately so
     *  they can just retry, rather than silently queuing it for later. */
    fun uploadHandover(file: File, notes: String?) {
        val ctx = _state.value.context ?: return
        _state.update { it.copy(handoverUploading = true, handoverError = null) }
        viewModelScope.launch {
            runCatching {
                val contentType = if (file.extension.equals("pdf", ignoreCase = true)) "application/pdf" else "image/jpeg"
                val urlResp = api.cfoHandoverUploadUrl(deviceToken, HandoverUploadUrlRequest(ctx.convoy.id, contentType))

                val putRequest = Request.Builder()
                    .url(urlResp.upload_url)
                    .put(file.asRequestBody(contentType.toMediaType()))
                    .build()
                withContext(Dispatchers.IO) {
                    okHttp.newCall(putRequest).execute().use { resp ->
                        if (!resp.isSuccessful) error("Upload failed: ${resp.code}")
                    }
                }

                api.cfoHandoverCommit(
                    deviceToken,
                    HandoverCommitRequest(ctx.convoy.id, urlResp.key, urlResp.public_url, notes)
                )
            }.onSuccess { resp ->
                _state.update { it.copy(handoverUploading = false, convoyEnded = resp.convoy_completed) }
            }.onFailure { e ->
                Log.w("CfoViewModel", "Handover upload failed: ${e.message}")
                _state.update { it.copy(handoverUploading = false, handoverError = e.message ?: "Handover upload failed") }
            }
        }
    }

    private fun refreshPendingCount() {
        viewModelScope.launch {
            val count = pendingPhotoDao.count()
            _state.update { it.copy(pendingCount = count) }
        }
    }
}
