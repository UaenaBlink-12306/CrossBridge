package dev.crossbridge.replyhelper

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Bundle

class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        postReplyNotification()
        finish()
    }

    private fun postReplyNotification() {
        val manager = getSystemService(NotificationManager::class.java) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(
                RuntimeReplyContract.CHANNEL_ID,
                getString(R.string.channel_name),
                NotificationManager.IMPORTANCE_DEFAULT
            )
        )

        val replyIntent = Intent(this, ReplyReceiver::class.java)
        val pendingIntent = PendingIntent.getBroadcast(
            this,
            0,
            replyIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
        val remoteInput = RemoteInput.Builder(RuntimeReplyContract.REMOTE_INPUT_KEY)
            .setLabel(getString(R.string.reply_label))
            .build()
        val replyAction = Notification.Action.Builder(
            Icon.createWithResource(this, android.R.drawable.sym_action_chat),
            getString(R.string.reply_label),
            pendingIntent
        ).addRemoteInput(remoteInput)
            .build()

        val notification = Notification.Builder(this, RuntimeReplyContract.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.sym_action_chat)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_text))
            .setAutoCancel(true)
            .addAction(replyAction)
            .build()

        manager.notify(
            RuntimeReplyContract.NOTIFICATION_TAG,
            RuntimeReplyContract.NOTIFICATION_ID,
            notification
        )
    }
}
