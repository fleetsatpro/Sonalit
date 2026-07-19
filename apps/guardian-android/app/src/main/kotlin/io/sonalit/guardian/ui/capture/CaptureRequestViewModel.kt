package io.sonalit.guardian.ui.capture

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.sonalit.guardian.data.remote.GuardianApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File
import javax.inject.Inject

/**
 * Backs CaptureRequestActivity — the officer-tap fallback for capture_photo used
 * when the covert PhotoCaptureService can't run (e.g. Android 12+ blocks a
 * background camera-FGS start). Same presign -> R2 PUT -> report path as the
 * covert service, just driven by a photo the officer took on screen.
 */
@HiltViewModel
class CaptureRequestViewModel @Inject constructor(
    private val api: GuardianApi,
    private val okHttp: OkHttpClient,
) : ViewModel() {

    enum class State { CAPTURING, UPLOADING, DONE, ERROR }

    private val _state = MutableStateFlow(State.CAPTURING)
    val state: StateFlow<State> = _state.asStateFlow()

    fun upload(file: File) {
        if (_state.value == State.UPLOADING) return
        _state.value = State.UPLOADING
        viewModelScope.launch(Dispatchers.IO) {
            val ok = runCatching {
                val presign = api.capturePhotoUrl()
                val put = Request.Builder()
                    .url(presign.upload_url)
                    .put(file.asRequestBody("image/jpeg".toMediaType()))
                    .build()
                okHttp.newCall(put).execute().use { resp ->
                    if (!resp.isSuccessful) error("R2 PUT failed: ${resp.code}")
                }
                api.capturePhoto(mapOf("public_url" to presign.public_url, "key" to presign.key))
            }.isSuccess
            runCatching { file.delete() }
            _state.value = if (ok) State.DONE else State.ERROR
        }
    }
}
