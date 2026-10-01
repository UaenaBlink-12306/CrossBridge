package dev.crossbridge.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import dev.crossbridge.android.ui.components.connectionStatusText
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.map

class ConnectionService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "PC connection", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val builder = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_connection)
            .setContentTitle("CrossBridge is running")
            .setContentText("Keeping your PC connection available")
            .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
        ServiceCompat.startForeground(this, NOTIFICATION_ID, builder.build(),
            if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0)
        val connection = (application as CrossBridgeApplication).connectionManager
        connection.start()
        scope.launch {
            connection.viewState.map { connectionStatusText(it.phase) }.distinctUntilChanged().collect { status ->
                manager.notify(NOTIFICATION_ID, builder.setContentText(status).build())
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onDestroy() { scope.cancel(); super.onDestroy() }

    companion object {
        private const val CHANNEL = "crossbridge_connection"
        private const val NOTIFICATION_ID = 702
        fun isEnabled(context: Context) = context.getSharedPreferences("crossbridge_background", Context.MODE_PRIVATE).getBoolean("enabled", false)
        fun setEnabled(context: Context, enabled: Boolean) {
            if (enabled) ContextCompat.startForegroundService(context, Intent(context, ConnectionService::class.java))
            else context.stopService(Intent(context, ConnectionService::class.java))
            context.getSharedPreferences("crossbridge_background", Context.MODE_PRIVATE).edit().putBoolean("enabled", enabled).apply()
        }
        fun resumeIfEnabled(context: Context) { if (isEnabled(context)) setEnabled(context, true) }
    }
}
