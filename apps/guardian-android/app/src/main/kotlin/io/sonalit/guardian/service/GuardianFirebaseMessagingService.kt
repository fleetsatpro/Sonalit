package io.sonalit.guardian.service

import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import io.sonalit.guardian.data.remote.GuardianApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import javax.inject.Inject

@AndroidEntryPoint
class GuardianFirebaseMessagingService : FirebaseMessagingService() {

    @Inject
    lateinit var api: GuardianApi

    @Inject
    lateinit var commandExecutor: CommandExecutor

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val prefs by lazy {
        val masterKey = MasterKey.Builder(applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            applicationContext,
            "guardian_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    override fun onNewToken(token: String) {
        prefs.edit().putString("fcm_token", token).apply()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        when (data["type"]) {
            "command" -> {
                val commandId = data["command_id"] ?: return
                val commandType = data["command_type"]
                val payload = data["payload"]
                serviceScope.launch {
                    val deviceId = prefs.getString("device_id", null)
                    val success = commandType != null && commandExecutor.execute(commandType, deviceId, payload)
                    runCatching {
                        api.ackCommand(mapOf("command_id" to commandId, "status" to if (success) "executed" else "failed"))
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
    }
}
