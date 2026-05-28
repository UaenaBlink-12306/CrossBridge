package dev.crossbridge.android

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings

fun isNotificationListenerEnabled(context: Context): Boolean {
    val expected = ComponentName(context, CrossBridgeNotificationListenerService::class.java)
    val enabled = Settings.Secure.getString(
        context.contentResolver,
        "enabled_notification_listeners"
    ) ?: return false

    return enabled.split(":").any { flattened ->
        val component = ComponentName.unflattenFromString(flattened) ?: return@any false
        component.packageName == expected.packageName && component.className == expected.className
    }
}

fun openNotificationListenerSettings(context: Context) {
    context.startActivity(
        Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    )
}
