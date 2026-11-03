package io.sonalit.guardian.service

import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.*
import javax.inject.Inject

@AndroidEntryPoint
class PanicTileService : TileService() {

    @Inject
    lateinit var panicSender: PanicSender

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    override fun onStartListening() {
        super.onStartListening()
        qsTile?.state = Tile.STATE_INACTIVE
        qsTile?.updateTile()
    }

    override fun onClick() {
        super.onClick()
        qsTile?.state = Tile.STATE_ACTIVE
        qsTile?.updateTile()
        scope.launch {
            try {
                panicSender.send(mode = "silent")
            } finally {
                delay(3_000)
                qsTile?.state = Tile.STATE_INACTIVE
                qsTile?.updateTile()
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }
}
