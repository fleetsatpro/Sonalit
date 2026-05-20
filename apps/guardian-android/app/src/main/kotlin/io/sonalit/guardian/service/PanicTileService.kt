package io.sonalit.guardian.service

import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import kotlinx.coroutines.*

class PanicTileService : TileService() {

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
                android.util.Log.w("PanicTile", "Panic triggered via Quick Settings tile")
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
