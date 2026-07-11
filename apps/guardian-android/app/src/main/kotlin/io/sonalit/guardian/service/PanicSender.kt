package io.sonalit.guardian.service

import android.content.Context
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import io.sonalit.guardian.data.local.AppDatabase
import io.sonalit.guardian.data.remote.GuardianApi
import io.sonalit.guardian.data.remote.PanicRequest
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Single source of truth for firing an SOS — used by both the in-app PANIC
 * button (MainViewModel) and the Quick Settings tile (PanicTileService), so
 * neither can drift out of sync with what the backend actually requires
 * (POST /guardian/panic 400s without a `mode`, per validModes in guardian.js).
 */
@Singleton
class PanicSender @Inject constructor(
    @ApplicationContext private val context: Context,
    private val db: AppDatabase,
    private val api: GuardianApi,
) {
    private val prefs by lazy {
        val masterKey = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context, "guardian_prefs", masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /** Returns true if the panic event reached the backend. */
    suspend fun send(mode: String = "silent", note: String? = null): Boolean = runCatching {
        val deviceId = prefs.getString("device_id", null) ?: return false
        val lastFix = db.gpsFixDao().getLatest()
        api.panic(
            PanicRequest(
                device_id = deviceId,
                mode = mode,
                lat = lastFix?.lat ?: 0.0,
                lon = lastFix?.lon ?: 0.0,
                event_uuid = UUID.randomUUID().toString(),
                note = note,
            ),
        )
        true
    }.onFailure {
        // Previously swallowed entirely — a failed SOS send (wrong mode, 4xx/5xx
        // from the backend, no network) looked identical in Logcat to a successful
        // one, since the only visible symptom was the generic "could not reach
        // dispatch" toast with no detail. Retrofit throws HttpException for any
        // non-2xx response, so this also surfaces the actual status/body for
        // server-side rejections, not just true connectivity failures.
        Log.e("PanicSender", "SOS send failed: ${it.message}", it)
    }.getOrDefault(false)

    /**
     * Resolves this device's open panic_events server-side (POST
     * /guardian/panic/cancel — deviceAuth, no body) and clears
     * guardian_devices.panic_active. Returns true only if the backend
     * actually confirmed the cancellation; callers must not locally clear
     * "panic active" UI state on a false return, since the server may still
     * consider the SOS live.
     */
    suspend fun cancel(): Boolean = runCatching {
        api.cancelPanic()
        true
    }.onFailure {
        Log.e("PanicSender", "SOS cancel failed: ${it.message}", it)
    }.getOrDefault(false)
}
