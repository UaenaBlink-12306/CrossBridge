package dev.crossbridge.android

import android.app.Notification
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.Intent
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import dev.crossbridge.android.network.NotificationActionPayload
import dev.crossbridge.android.network.NotificationDismissResultPayload
import dev.crossbridge.android.network.NotificationMirrorBridge
import dev.crossbridge.android.network.NotificationPostedPayload
import dev.crossbridge.android.network.NotificationReplyResultPayload
import dev.crossbridge.android.network.NotificationRemovedPayload

class CrossBridgeNotificationListenerService : NotificationListenerService() {
    override fun onListenerConnected() {
        activeService = this
    }

    override fun onListenerDisconnected() {
        if (activeService === this) {
            activeService = null
        }
    }

    override fun onDestroy() {
        if (activeService === this) {
            activeService = null
        }
        super.onDestroy()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val payload = sbn.toNotificationPostedPayload() ?: return
        NotificationMirrorBridge.post(payload)
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        NotificationMirrorBridge.remove(
            NotificationRemovedPayload(notificationId = sbn.notificationMirrorId())
        )
    }

    private fun StatusBarNotification.toNotificationPostedPayload(): NotificationPostedPayload? {
        val notification = notification ?: return null
        val extras = notification.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
        val text = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
            ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
            ?: extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.joinToString("\n") { it.toString() }
        val subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()

        return NotificationPostedPayload(
            notificationId = notificationMirrorId(),
            packageName = packageName,
            appName = appLabel(packageName),
            title = title?.takeIf { it.isNotBlank() }?.take(512),
            text = text?.takeIf { it.isNotBlank() }?.take(4096),
            subText = subText?.takeIf { it.isNotBlank() }?.take(512),
            postTime = postTime,
            canDismiss = isClearable,
            actions = notification.actions
                ?.mapIndexedNotNull { index, action -> action.toPayload(index) }
                ?.take(16)
                ?: emptyList()
        )
    }

    private fun Notification.Action.toPayload(index: Int): NotificationActionPayload? {
        val actionTitle = title?.toString()?.trim()?.takeIf { it.isNotBlank() } ?: return null
        return NotificationActionPayload(
            actionId = "action_$index",
            title = actionTitle.take(128),
            supportsRemoteInput = replyRemoteInput() != null
        )
    }

    private fun dismissNotificationByMirrorId(notificationId: String): NotificationDismissResultPayload {
        val trimmedId = notificationId.trim().takeIf { it.isNotBlank() }
            ?: return notificationDismissFailure(
                notificationId = notificationId,
                message = "CrossBridge could not identify that Android notification."
            )

        val active = activeNotifications?.firstOrNull { it.notificationMirrorId() == trimmedId }
            ?: return NotificationDismissResultPayload(
                notificationId = trimmedId,
                dismissed = true
            )

        if (!active.isClearable) {
            return notificationDismissFailure(
                notificationId = trimmedId,
                message = "Android reports that this notification cannot be dismissed."
            )
        }

        return try {
            if (active.key.isNotBlank()) {
                cancelNotification(active.key)
            } else {
                @Suppress("DEPRECATION")
                cancelNotification(active.packageName, active.tag, active.id)
            }
            NotificationDismissResultPayload(
                notificationId = trimmedId,
                dismissed = true
            )
        } catch (error: SecurityException) {
            notificationDismissFailure(
                notificationId = trimmedId,
                errorCode = ERROR_CODE_PERMISSION_MISSING,
                message = "Notification access needs to stay enabled on Android to dismiss notifications."
            )
        } catch (error: Throwable) {
            notificationDismissFailure(
                notificationId = trimmedId,
                message = error.message ?: "Android could not dismiss that notification."
            )
        }
    }

    private fun replyToNotificationByMirrorId(
        notificationId: String,
        actionId: String,
        replyText: String
    ): NotificationReplyResultPayload {
        val trimmedId = notificationId.trim().takeIf { it.isNotBlank() }
            ?: return notificationReplyFailure(
                notificationId = notificationId,
                actionId = actionId,
                message = "CrossBridge could not identify that Android notification."
            )
        val trimmedActionId = actionId.trim().takeIf { it.isNotBlank() }
            ?: return notificationReplyFailure(
                notificationId = trimmedId,
                actionId = actionId,
                errorCode = ERROR_CODE_NOTIFICATION_REPLY_UNSUPPORTED,
                message = "Android no longer exposes a reply action for this notification."
            )
        val trimmedReplyText = replyText.trim().takeIf { it.isNotBlank() }
            ?: return notificationReplyFailure(
                notificationId = trimmedId,
                actionId = trimmedActionId,
                message = "Type a reply before sending it from Windows."
            )

        if (trimmedReplyText.length > 4_096) {
            return notificationReplyFailure(
                notificationId = trimmedId,
                actionId = trimmedActionId,
                message = "Replies can be up to 4096 characters."
            )
        }

        val active = activeNotifications?.firstOrNull { it.notificationMirrorId() == trimmedId }
            ?: return notificationReplyFailure(
                notificationId = trimmedId,
                actionId = trimmedActionId,
                message = "Android could not find that notification anymore."
            )
        val action = active.notification.actions?.actionForId(trimmedActionId)
            ?: return notificationReplyFailure(
                notificationId = trimmedId,
                actionId = trimmedActionId,
                errorCode = ERROR_CODE_NOTIFICATION_REPLY_UNSUPPORTED,
                message = "Android no longer exposes a reply action for this notification."
            )
        val remoteInput = action.replyRemoteInput()
            ?: return notificationReplyFailure(
                notificationId = trimmedId,
                actionId = trimmedActionId,
                errorCode = ERROR_CODE_NOTIFICATION_REPLY_UNSUPPORTED,
                message = "Android no longer exposes a reply action for this notification."
            )
        val actionIntent = action.actionIntent
            ?: return notificationReplyFailure(
                notificationId = trimmedId,
                actionId = trimmedActionId,
                errorCode = ERROR_CODE_NOTIFICATION_REPLY_UNSUPPORTED,
                message = "Android no longer exposes a reply action for this notification."
            )

        return try {
            val replyIntent = Intent().addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
            val remoteInputResults = Bundle().apply {
                putCharSequence(remoteInput.resultKey, trimmedReplyText)
            }
            RemoteInput.addResultsToIntent(arrayOf(remoteInput), replyIntent, remoteInputResults)
            actionIntent.send(applicationContext, 0, replyIntent)
            NotificationReplyResultPayload(
                notificationId = trimmedId,
                actionId = trimmedActionId,
                replied = true,
                message = "Reply sent on Android."
            )
        } catch (error: SecurityException) {
            notificationReplyFailure(
                notificationId = trimmedId,
                actionId = trimmedActionId,
                errorCode = ERROR_CODE_PERMISSION_MISSING,
                message = "Notification access needs to stay enabled on Android to send replies."
            )
        } catch (error: PendingIntent.CanceledException) {
            notificationReplyFailure(
                notificationId = trimmedId,
                actionId = trimmedActionId,
                errorCode = ERROR_CODE_NOTIFICATION_REPLY_UNSUPPORTED,
                message = "That Android app no longer accepts replies from this notification."
            )
        } catch (error: Throwable) {
            notificationReplyFailure(
                notificationId = trimmedId,
                actionId = trimmedActionId,
                message = error.message ?: "Android could not send that reply."
            )
        }
    }

    private fun StatusBarNotification.notificationMirrorId(): String {
        return key.take(256).ifBlank { "$packageName:$id:${tag.orEmpty()}" }.take(256)
    }

    private fun Notification.Action.replyRemoteInput(): RemoteInput? {
        return remoteInputs?.firstOrNull { it.allowFreeFormInput && it.resultKey.isNotBlank() }
    }

    private fun Array<Notification.Action>.actionForId(actionId: String): Notification.Action? {
        val index = actionId.removePrefix("action_").toIntOrNull() ?: return null
        return getOrNull(index)
    }

    private fun appLabel(packageName: String): String {
        return try {
            val packageManager = applicationContext.packageManager
            val appInfo = packageManager.getApplicationInfo(packageName, 0)
            packageManager.getApplicationLabel(appInfo).toString().takeIf { it.isNotBlank() } ?: packageName
        } catch (_: Exception) {
            packageName
        }.take(128)
    }

    companion object {
        @Volatile
        private var activeService: CrossBridgeNotificationListenerService? = null

        private const val ERROR_CODE_PERMISSION_MISSING = "PERMISSION_MISSING"
        private const val ERROR_CODE_NOTIFICATION_REPLY_UNSUPPORTED = "NOTIFICATION_REPLY_UNSUPPORTED"
        private const val ERROR_CODE_UNKNOWN = "UNKNOWN"

        fun dismissMirroredNotification(notificationId: String): NotificationDismissResultPayload {
            val service = activeService
                ?: return notificationDismissFailure(
                    notificationId = notificationId,
                    errorCode = ERROR_CODE_PERMISSION_MISSING,
                    message = "Notification access is not active on Android right now."
                )

            return service.dismissNotificationByMirrorId(notificationId)
        }

        fun replyToMirroredNotification(
            notificationId: String,
            actionId: String,
            replyText: String
        ): NotificationReplyResultPayload {
            val service = activeService
                ?: return notificationReplyFailure(
                    notificationId = notificationId,
                    actionId = actionId,
                    errorCode = ERROR_CODE_PERMISSION_MISSING,
                    message = "Notification access is not active on Android right now."
                )

            return service.replyToNotificationByMirrorId(notificationId, actionId, replyText)
        }

        fun findMirroredNotificationId(
            packageName: String,
            notificationId: Int,
            notificationTag: String?
        ): String? {
            val service = activeService ?: return null
            return service.activeNotifications
                ?.firstOrNull {
                    it.packageName == packageName &&
                        it.id == notificationId &&
                        it.tag == notificationTag
                }
                ?.let { sbn ->
                    sbn.key.take(256).ifBlank { "${sbn.packageName}:${sbn.id}:${sbn.tag.orEmpty()}" }.take(256)
                }
        }

        private fun notificationDismissFailure(
            notificationId: String,
            errorCode: String = ERROR_CODE_UNKNOWN,
            message: String
        ): NotificationDismissResultPayload {
            return NotificationDismissResultPayload(
                notificationId = notificationId.take(256),
                dismissed = false,
                errorCode = errorCode,
                message = message.take(512)
            )
        }

        private fun notificationReplyFailure(
            notificationId: String,
            actionId: String,
            errorCode: String = ERROR_CODE_UNKNOWN,
            message: String
        ): NotificationReplyResultPayload {
            return NotificationReplyResultPayload(
                notificationId = notificationId.take(256),
                actionId = actionId.take(128),
                replied = false,
                errorCode = errorCode,
                message = message.take(512)
            )
        }
    }
}
