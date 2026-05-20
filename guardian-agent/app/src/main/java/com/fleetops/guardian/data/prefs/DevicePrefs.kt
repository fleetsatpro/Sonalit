package com.fleetops.guardian.data.prefs

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "guardian_prefs")

@Singleton
class DevicePrefs @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val dataStore = context.dataStore

    // ─── Keys ─────────────────────────────────────────────────────────────────

    private object Keys {
        val DEVICE_ID = stringPreferencesKey("device_id")
        val DEVICE_TOKEN = stringPreferencesKey("device_token")
        val SERVER_URL = stringPreferencesKey("server_url")
        val ORG_TOKEN = stringPreferencesKey("org_token")
        val IS_ENROLLED = booleanPreferencesKey("is_enrolled")
        val TRACKING_MODE = stringPreferencesKey("tracking_mode")
        val TRACKING_INTERVAL_SECONDS = intPreferencesKey("tracking_interval_seconds")
        val DEVICE_NAME = stringPreferencesKey("device_name")
        val LAST_HEARTBEAT_AT = longPreferencesKey("last_heartbeat_at")
        val LAST_LOCATION_LAT = doublePreferencesKey("last_location_lat")
        val LAST_LOCATION_LNG = doublePreferencesKey("last_location_lng")
        val LAST_LOCATION_AT = longPreferencesKey("last_location_at")
        val CONVOY_CONTEXT_JSON = stringPreferencesKey("convoy_context_json")
    }

    // ─── Safe read helper ─────────────────────────────────────────────────────

    private val safePrefsFlow: Flow<Preferences> = dataStore.data
        .catch { exception ->
            if (exception is IOException) {
                emit(emptyPreferences())
            } else {
                throw exception
            }
        }

    // ─── Flows ────────────────────────────────────────────────────────────────

    val deviceIdFlow: Flow<String> = safePrefsFlow.map { it[Keys.DEVICE_ID] ?: "" }
    val deviceTokenFlow: Flow<String> = safePrefsFlow.map { it[Keys.DEVICE_TOKEN] ?: "" }
    val serverUrlFlow: Flow<String> = safePrefsFlow.map {
        it[Keys.SERVER_URL] ?: com.fleetops.guardian.BuildConfig.SERVER_URL
    }
    val orgTokenFlow: Flow<String> = safePrefsFlow.map { it[Keys.ORG_TOKEN] ?: "" }
    val isEnrolledFlow: Flow<Boolean> = safePrefsFlow.map { it[Keys.IS_ENROLLED] ?: false }
    val trackingModeFlow: Flow<String> = safePrefsFlow.map {
        it[Keys.TRACKING_MODE] ?: TrackingMode.NORMAL
    }
    val trackingIntervalSecondsFlow: Flow<Int> = safePrefsFlow.map {
        it[Keys.TRACKING_INTERVAL_SECONDS] ?: DEFAULT_INTERVAL_SECONDS
    }
    val deviceNameFlow: Flow<String> = safePrefsFlow.map { it[Keys.DEVICE_NAME] ?: "" }

    // ─── Suspend getters (one-shot reads) ─────────────────────────────────────

    suspend fun deviceId(): String = deviceIdFlow.first()
    suspend fun deviceToken(): String = deviceTokenFlow.first()
    suspend fun serverUrl(): String = serverUrlFlow.first()
    suspend fun orgToken(): String = orgTokenFlow.first()
    suspend fun isEnrolled(): Boolean = isEnrolledFlow.first()
    suspend fun trackingMode(): String = trackingModeFlow.first()
    suspend fun trackingIntervalSeconds(): Int = trackingIntervalSecondsFlow.first()
    suspend fun deviceName(): String = deviceNameFlow.first()

    // ─── Writers ──────────────────────────────────────────────────────────────

    suspend fun saveEnrollment(
        deviceId: String,
        deviceToken: String,
        serverUrl: String,
        orgToken: String,
        deviceName: String,
        trackingMode: String = TrackingMode.NORMAL,
        trackingIntervalSeconds: Int = DEFAULT_INTERVAL_SECONDS
    ) {
        dataStore.edit { prefs ->
            prefs[Keys.DEVICE_ID] = deviceId
            prefs[Keys.DEVICE_TOKEN] = deviceToken
            prefs[Keys.SERVER_URL] = serverUrl
            prefs[Keys.ORG_TOKEN] = orgToken
            prefs[Keys.DEVICE_NAME] = deviceName
            prefs[Keys.IS_ENROLLED] = true
            prefs[Keys.TRACKING_MODE] = trackingMode
            prefs[Keys.TRACKING_INTERVAL_SECONDS] = trackingIntervalSeconds
        }
    }

    suspend fun setDeviceToken(token: String) {
        dataStore.edit { it[Keys.DEVICE_TOKEN] = token }
    }

    suspend fun setServerUrl(url: String) {
        dataStore.edit { it[Keys.SERVER_URL] = url }
    }

    suspend fun setTrackingMode(mode: String) {
        dataStore.edit { it[Keys.TRACKING_MODE] = mode }
    }

    suspend fun setTrackingIntervalSeconds(seconds: Int) {
        dataStore.edit { it[Keys.TRACKING_INTERVAL_SECONDS] = seconds }
    }

    suspend fun setLastHeartbeat(timestampMs: Long) {
        dataStore.edit { it[Keys.LAST_HEARTBEAT_AT] = timestampMs }
    }

    suspend fun setLastLocation(lat: Double, lng: Double, timestampMs: Long) {
        dataStore.edit { prefs ->
            prefs[Keys.LAST_LOCATION_LAT] = lat
            prefs[Keys.LAST_LOCATION_LNG] = lng
            prefs[Keys.LAST_LOCATION_AT] = timestampMs
        }
    }

    suspend fun convoyContextJson(): String? =
        safePrefsFlow.map { it[Keys.CONVOY_CONTEXT_JSON] }.first()

    suspend fun saveConvoyContext(json: String) {
        dataStore.edit { it[Keys.CONVOY_CONTEXT_JSON] = json }
    }

    suspend fun clearAll() {
        dataStore.edit { it.clear() }
    }

    // ─── Constants ────────────────────────────────────────────────────────────

    object TrackingMode {
        const val NORMAL = "normal"
        const val LIVE = "live"
        const val STEALTH = "stealth"
        const val EMERGENCY = "emergency"
    }

    companion object {
        const val DEFAULT_INTERVAL_SECONDS = 30
    }
}
