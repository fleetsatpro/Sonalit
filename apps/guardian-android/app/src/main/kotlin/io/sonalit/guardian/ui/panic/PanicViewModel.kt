package io.sonalit.guardian.ui.panic

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import io.sonalit.guardian.data.local.PanicPinStore
import io.sonalit.guardian.service.PanicSender
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject

@HiltViewModel
class PanicViewModel @Inject constructor(
    private val panicSender: PanicSender,
    private val pinStore: PanicPinStore,
) : ViewModel() {

    val showCancelDialog = mutableStateOf(false)
    val cancelError = mutableStateOf<String?>(null)
    /** True once the countdown finished and activatePanic ran but the backend call itself failed
     * (no network, device not enrolled, etc.) — shown so the operator knows to seek help another way. */
    val panicSendFailed = mutableStateOf(false)
    /** Bumped on every activation; PanicButtonScreen observes this to run its own CameraX burst
     * capture, since binding a camera requires a LifecycleOwner the ViewModel doesn't have. */
    val cameraBurstTrigger = mutableStateOf(0)

    private var mediaRecorder: MediaRecorder? = null

    /**
     * The SOS network call is unconditional and goes out immediately, before anything else —
     * it must never be gated behind camera/microphone permission prompts. Audio recording and
     * the camera burst (triggered by the composable observing cameraBurstTrigger) are best-effort
     * evidence capture on top of that, and silently no-op if permission was never granted.
     *
     * `mode` defaults to "silent" (the normal hardware-trigger case — volume keys, in-app
     * button) but callers that know *why* this fired (e.g. PanicActivity reading a
     * "panic_mode" intent extra) can pass one of the other backend-recognized modes so the
     * dashboard can react differently (a distinct siren per mode — see apps/web/src/lib/siren.ts).
     */
    fun activatePanic(context: Context, mode: String = "silent") {
        showCancelDialog.value = true
        cancelError.value = null
        panicSendFailed.value = false
        viewModelScope.launch {
            val sent = panicSender.send(mode = mode)
            panicSendFailed.value = !sent
        }
        startAudioRecording(context)
        cameraBurstTrigger.value += 1
    }

    fun cancelWithPin(pin: String) {
        if (!pinStore.hasPin()) {
            cancelError.value = "No cancel PIN set — set one in Settings first"
            return
        }
        if (pinStore.verify(pin)) {
            performCancel()
        } else {
            cancelError.value = "Incorrect PIN"
        }
    }

    fun onBiometricSuccess() = performCancel()

    /** Operator chose to let it escalate instead of authenticating — SOS stays active server-side. */
    fun dismissCancelDialog() {
        showCancelDialog.value = false
    }

    private fun performCancel() {
        viewModelScope.launch {
            if (panicSender.cancel()) {
                showCancelDialog.value = false
                cancelError.value = null
                stopAudioRecording()
            } else {
                cancelError.value = "Could not reach dispatch to cancel — try again"
            }
        }
    }

    private fun startAudioRecording(context: Context) {
        try {
            val file = File(context.cacheDir, "panic_${System.currentTimeMillis()}.m4a")
            val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(context)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }
            mediaRecorder = recorder.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setOutputFile(file.absolutePath)
                prepare()
                start()
            }
        } catch (_: Exception) {
            // Mic missing/denied/busy — the panic signal itself already went out regardless.
        }
    }

    private fun stopAudioRecording() {
        try {
            mediaRecorder?.apply { stop(); release() }
        } catch (_: Exception) {
        } finally {
            mediaRecorder = null
            // Kept on disk as local evidence — there is no backend endpoint yet to upload
            // panic audio/photos, so this intentionally is not deleted or auto-uploaded.
        }
    }

    override fun onCleared() {
        super.onCleared()
        try { mediaRecorder?.apply { stop(); release() } } catch (_: Exception) {}
    }
}
