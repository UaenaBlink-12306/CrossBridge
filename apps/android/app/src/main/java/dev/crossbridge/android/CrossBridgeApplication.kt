package dev.crossbridge.android

import android.app.Application
import dev.crossbridge.android.network.ConnectionManager

class CrossBridgeApplication : Application() {
    val connectionManager: ConnectionManager by lazy(LazyThreadSafetyMode.SYNCHRONIZED) {
        ConnectionManager(this)
    }

    override fun onCreate() {
        super.onCreate()
        connectionManager.start()
    }
}
