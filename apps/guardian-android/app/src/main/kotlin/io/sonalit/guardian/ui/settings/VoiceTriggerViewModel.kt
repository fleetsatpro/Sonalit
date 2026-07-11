package io.sonalit.guardian.ui.settings

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import io.sonalit.guardian.data.local.VoiceTriggerStore
import io.sonalit.guardian.service.VoiceTriggerService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject

@HiltViewModel
class VoiceTriggerViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val store: VoiceTriggerStore,
) : ViewModel() {

    private val _enabled = MutableStateFlow(store.isEnabled())
    val enabled: StateFlow<Boolean> = _enabled.asStateFlow()

    /** Call only after RECORD_AUDIO has been granted — the caller (SettingsScreen) owns the permission request. */
    fun setEnabled(enabled: Boolean) {
        store.setEnabled(enabled)
        _enabled.value = enabled
        if (enabled) {
            ContextCompat.startForegroundService(context, Intent(context, VoiceTriggerService::class.java))
        } else {
            context.stopService(Intent(context, VoiceTriggerService::class.java))
        }
    }
}
