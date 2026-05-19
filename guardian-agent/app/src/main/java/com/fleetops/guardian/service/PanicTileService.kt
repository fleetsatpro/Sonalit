package com.fleetops.guardian.service

import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import androidx.annotation.RequiresApi

@RequiresApi(Build.VERSION_CODES.N)
class PanicTileService : TileService() {

    override fun onStartListening() {
        qsTile?.let {
            it.label = "PANIC / SOS"
            it.state = Tile.STATE_INACTIVE
            it.updateTile()
        }
    }

    override fun onClick() {
        val intent = Intent(applicationContext, GuardianService::class.java).apply {
            action = GuardianService.ACTION_QUICK_PANIC
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            applicationContext.startForegroundService(intent)
        } else {
            applicationContext.startService(intent)
        }
        qsTile?.let {
            it.state = Tile.STATE_ACTIVE
            it.label = "SOS SENT"
            it.updateTile()
            postDelayed({ it.state = Tile.STATE_INACTIVE; it.label = "PANIC / SOS"; it.updateTile() }, 3000)
        }
    }
}
