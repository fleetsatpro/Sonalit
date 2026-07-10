package io.sonalit.guardian.ui.settings

import androidx.lifecycle.ViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import io.sonalit.guardian.data.local.PanicPinStore
import javax.inject.Inject

@HiltViewModel
class PanicPinViewModel @Inject constructor(
    private val pinStore: PanicPinStore,
) : ViewModel() {
    fun hasPin(): Boolean = pinStore.hasPin()
    fun setPin(pin: String) = pinStore.setPin(pin)
}
