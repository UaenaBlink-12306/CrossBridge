package dev.crossbridge.android.network

import dev.crossbridge.android.crypto.AppMessageCrypto
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

const val NOTIFICATION_POSTED_TYPE = "NOTIFICATION_POSTED"
const val NOTIFICATION_REMOVED_TYPE = "NOTIFICATION_REMOVED"
const val NOTIFICATION_DISMISS_TYPE = "NOTIFICATION_DISMISS"
const val NOTIFICATION_REPLY_TYPE = "NOTIFICATION_REPLY"
const val NOTIFICATION_DISMISS_RESULT_TYPE = "NOTIFICATION_DISMISS_RESULT"
const val NOTIFICATION_REPLY_RESULT_TYPE = "NOTIFICATION_REPLY_RESULT"

data class NotificationActionPayload(
    val actionId: String,
    val title: String,
    val supportsRemoteInput: Boolean
)

data class NotificationPostedPayload(
    val notificationId: String,
    val packageName: String,
    val appName: String,
    val title: String?,
    val text: String?,
    val subText: String?,
    val postTime: Long,
    val canDismiss: Boolean,
    val actions: List<NotificationActionPayload>
)

data class NotificationRemovedPayload(
    val notificationId: String
)

data class NotificationDismissPayload(
    val notificationId: String
)

data class NotificationReplyPayload(
    val notificationId: String,
    val actionId: String,
    val replyText: String
)

data class NotificationDismissResultPayload(
    val notificationId: String,
    val dismissed: Boolean,
    val errorCode: String? = null,
    val message: String? = null
)

data class NotificationReplyResultPayload(
    val notificationId: String,
    val actionId: String,
    val replied: Boolean,
    val errorCode: String? = null,
    val message: String? = null
)

sealed interface NotificationControlMessage {
    data class Posted(val payload: NotificationPostedPayload) : NotificationControlMessage
    data class Removed(val payload: NotificationRemovedPayload) : NotificationControlMessage
    data class Dismiss(val payload: NotificationDismissPayload) : NotificationControlMessage
    data class Reply(val payload: NotificationReplyPayload) : NotificationControlMessage
    data class DismissResult(val payload: NotificationDismissResultPayload) : NotificationControlMessage
    data class ReplyResult(val payload: NotificationReplyResultPayload) : NotificationControlMessage
}

data class DecodedNotificationEnvelope(
    val envelope: RelayEnvelope,
    val controlMessage: NotificationControlMessage
)

fun createNotificationPostedEnvelope(
    fromDeviceId: String,
    toDeviceId: String,
    payload: NotificationPostedPayload,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String,
    now: Long = System.currentTimeMillis()
): RelayEnvelope {
    return createRelayPayloadEnvelope(
        fromDeviceId = fromDeviceId,
        toDeviceId = toDeviceId,
        controlMessage = JSONObject()
            .put("type", NOTIFICATION_POSTED_TYPE)
            .put("payload", payload.toJson()),
        now = now,
        localPrivateKey = localPrivateKey,
        localPublicKey = localPublicKey,
        peerPublicKey = peerPublicKey
    )
}

fun createNotificationRemovedEnvelope(
    fromDeviceId: String,
    toDeviceId: String,
    payload: NotificationRemovedPayload,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String,
    now: Long = System.currentTimeMillis()
): RelayEnvelope {
    return createRelayPayloadEnvelope(
        fromDeviceId = fromDeviceId,
        toDeviceId = toDeviceId,
        controlMessage = JSONObject()
            .put("type", NOTIFICATION_REMOVED_TYPE)
            .put("payload", payload.toJson()),
        now = now,
        localPrivateKey = localPrivateKey,
        localPublicKey = localPublicKey,
        peerPublicKey = peerPublicKey
    )
}

fun createNotificationDismissEnvelope(
    fromDeviceId: String,
    toDeviceId: String,
    payload: NotificationDismissPayload,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String,
    now: Long = System.currentTimeMillis()
): RelayEnvelope {
    return createRelayPayloadEnvelope(
        fromDeviceId = fromDeviceId,
        toDeviceId = toDeviceId,
        controlMessage = JSONObject()
            .put("type", NOTIFICATION_DISMISS_TYPE)
            .put("payload", payload.toJson()),
        now = now,
        localPrivateKey = localPrivateKey,
        localPublicKey = localPublicKey,
        peerPublicKey = peerPublicKey
    )
}

fun createNotificationReplyEnvelope(
    fromDeviceId: String,
    toDeviceId: String,
    payload: NotificationReplyPayload,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String,
    now: Long = System.currentTimeMillis()
): RelayEnvelope {
    return createRelayPayloadEnvelope(
        fromDeviceId = fromDeviceId,
        toDeviceId = toDeviceId,
        controlMessage = JSONObject()
            .put("type", NOTIFICATION_REPLY_TYPE)
            .put("payload", payload.toJson()),
        now = now,
        localPrivateKey = localPrivateKey,
        localPublicKey = localPublicKey,
        peerPublicKey = peerPublicKey
    )
}

fun createNotificationDismissResultEnvelope(
    fromDeviceId: String,
    toDeviceId: String,
    payload: NotificationDismissResultPayload,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String,
    now: Long = System.currentTimeMillis()
): RelayEnvelope {
    return createRelayPayloadEnvelope(
        fromDeviceId = fromDeviceId,
        toDeviceId = toDeviceId,
        controlMessage = JSONObject()
            .put("type", NOTIFICATION_DISMISS_RESULT_TYPE)
            .put("payload", payload.toJson()),
        now = now,
        localPrivateKey = localPrivateKey,
        localPublicKey = localPublicKey,
        peerPublicKey = peerPublicKey
    )
}

fun createNotificationReplyResultEnvelope(
    fromDeviceId: String,
    toDeviceId: String,
    payload: NotificationReplyResultPayload,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String,
    now: Long = System.currentTimeMillis()
): RelayEnvelope {
    return createRelayPayloadEnvelope(
        fromDeviceId = fromDeviceId,
        toDeviceId = toDeviceId,
        controlMessage = JSONObject()
            .put("type", NOTIFICATION_REPLY_RESULT_TYPE)
            .put("payload", payload.toJson()),
        now = now,
        localPrivateKey = localPrivateKey,
        localPublicKey = localPublicKey,
        peerPublicKey = peerPublicKey
    )
}

fun decodeNotificationEnvelope(
    message: JSONObject,
    localDeviceId: String,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String
): DecodedNotificationEnvelope? {
    val envelope = message.toRelayEnvelope() ?: return null
    val appMessage = try {
        AppMessageCrypto.decrypt(
            envelope = message,
            localDeviceId = localDeviceId,
            localPrivateKey = localPrivateKey,
            localPublicKey = localPublicKey,
            peerPublicKey = peerPublicKey
        )
    } catch (_: Exception) {
        return null
    }

    if (appMessage.id != envelope.messageId ||
        appMessage.fromDeviceId != envelope.fromDeviceId ||
        appMessage.toDeviceId != envelope.toDeviceId
    ) {
        return null
    }

    val payload = appMessage.payload
    val controlMessage = when (appMessage.type) {
        NOTIFICATION_POSTED_TYPE -> NotificationControlMessage.Posted(payload.toNotificationPostedPayload() ?: return null)
        NOTIFICATION_REMOVED_TYPE -> NotificationControlMessage.Removed(payload.toNotificationRemovedPayload() ?: return null)
        NOTIFICATION_DISMISS_TYPE -> NotificationControlMessage.Dismiss(payload.toNotificationDismissPayload() ?: return null)
        NOTIFICATION_REPLY_TYPE -> NotificationControlMessage.Reply(payload.toNotificationReplyPayload() ?: return null)
        NOTIFICATION_DISMISS_RESULT_TYPE -> NotificationControlMessage.DismissResult(
            payload.toNotificationDismissResultPayload() ?: return null
        )
        NOTIFICATION_REPLY_RESULT_TYPE -> NotificationControlMessage.ReplyResult(
            payload.toNotificationReplyResultPayload() ?: return null
        )
        else -> return null
    }

    return DecodedNotificationEnvelope(envelope = envelope, controlMessage = controlMessage)
}

private fun NotificationPostedPayload.toJson(): JSONObject {
    return JSONObject()
        .put("notificationId", notificationId.trim().takeIf { it.isNotBlank() } ?: error("notificationId is required"))
        .put("packageName", packageName.trim().takeIf { it.isNotBlank() } ?: error("packageName is required"))
        .put("appName", appName.trim().takeIf { it.isNotBlank() } ?: packageName)
        .put("title", title?.take(512))
        .put("text", text?.take(4096))
        .put("subText", subText?.take(512))
        .put("postTime", postTime.coerceAtLeast(0))
        .put("canDismiss", canDismiss)
        .put("actions", JSONArray(actions.take(16).map { it.toJson() }))
}

private fun NotificationRemovedPayload.toJson(): JSONObject {
    return JSONObject()
        .put("notificationId", notificationId.trim().takeIf { it.isNotBlank() } ?: error("notificationId is required"))
}

private fun NotificationDismissPayload.toJson(): JSONObject {
    return JSONObject()
        .put("notificationId", notificationId.trim().takeIf { it.isNotBlank() } ?: error("notificationId is required"))
}

private fun NotificationReplyPayload.toJson(): JSONObject {
    return JSONObject()
        .put("notificationId", notificationId.trim().takeIf { it.isNotBlank() } ?: error("notificationId is required"))
        .put("actionId", actionId.trim().takeIf { it.isNotBlank() } ?: error("actionId is required"))
        .put("replyText", replyText.trim().takeIf { it.isNotBlank() }?.take(4096) ?: error("replyText is required"))
}

private fun NotificationDismissResultPayload.toJson(): JSONObject {
    return JSONObject()
        .put("notificationId", notificationId.trim().takeIf { it.isNotBlank() } ?: error("notificationId is required"))
        .put("dismissed", dismissed)
        .also { json ->
            if (errorCode != null) {
                json.put("errorCode", errorCode.trim().takeIf { it.isNotBlank() } ?: error("errorCode is required"))
            }
            if (message != null) {
                json.put("message", message.trim().takeIf { it.isNotBlank() }?.take(512) ?: error("message is required"))
            }
        }
}

private fun NotificationReplyResultPayload.toJson(): JSONObject {
    return JSONObject()
        .put("notificationId", notificationId.trim().takeIf { it.isNotBlank() } ?: error("notificationId is required"))
        .put("actionId", actionId.trim().takeIf { it.isNotBlank() } ?: error("actionId is required"))
        .put("replied", replied)
        .also { json ->
            if (errorCode != null) {
                json.put("errorCode", errorCode.trim().takeIf { it.isNotBlank() } ?: error("errorCode is required"))
            }
            if (message != null) {
                json.put("message", message.trim().takeIf { it.isNotBlank() }?.take(512) ?: error("message is required"))
            }
        }
}

private fun NotificationActionPayload.toJson(): JSONObject {
    return JSONObject()
        .put("actionId", actionId.trim().takeIf { it.isNotBlank() } ?: error("actionId is required"))
        .put("title", title.trim().takeIf { it.isNotBlank() } ?: error("title is required"))
        .put("supportsRemoteInput", supportsRemoteInput)
}

fun JSONObject.toNotificationPostedPayload(): NotificationPostedPayload? {
    return try {
        val actionsJson = optJSONArray("actions") ?: JSONArray()
        val actions = mutableListOf<NotificationActionPayload>()
        for (index in 0 until actionsJson.length()) {
            val action = actionsJson.optJSONObject(index) ?: continue
            val actionId = action.getString("actionId").trim().takeIf { it.isNotBlank() } ?: continue
            val title = action.getString("title").trim().takeIf { it.isNotBlank() } ?: continue
            actions.add(
                NotificationActionPayload(
                    actionId = actionId,
                    title = title,
                    supportsRemoteInput = action.optBoolean("supportsRemoteInput", false)
                )
            )
        }
        NotificationPostedPayload(
            notificationId = getString("notificationId").trim().takeIf { it.isNotBlank() } ?: return null,
            packageName = getString("packageName").trim().takeIf { it.isNotBlank() } ?: return null,
            appName = getString("appName").trim().takeIf { it.isNotBlank() } ?: return null,
            title = optString("title").takeIf { !isNull("title") }?.take(512),
            text = optString("text").takeIf { !isNull("text") }?.take(4096),
            subText = optString("subText").takeIf { !isNull("subText") }?.take(512),
            postTime = getLong("postTime").coerceAtLeast(0),
            canDismiss = optBoolean("canDismiss", true),
            actions = actions.take(16)
        )
    } catch (_: JSONException) {
        null
    }
}

private fun JSONObject.toNotificationRemovedPayload(): NotificationRemovedPayload? {
    return try {
        NotificationRemovedPayload(
            notificationId = getString("notificationId").trim().takeIf { it.isNotBlank() } ?: return null
        )
    } catch (_: JSONException) {
        null
    }
}

private fun JSONObject.toNotificationDismissPayload(): NotificationDismissPayload? {
    return try {
        NotificationDismissPayload(
            notificationId = getString("notificationId").trim().takeIf { it.isNotBlank() } ?: return null
        )
    } catch (_: JSONException) {
        null
    }
}

private fun JSONObject.toNotificationReplyPayload(): NotificationReplyPayload? {
    return try {
        NotificationReplyPayload(
            notificationId = getString("notificationId").trim().takeIf { it.isNotBlank() } ?: return null,
            actionId = getString("actionId").trim().takeIf { it.isNotBlank() } ?: return null,
            replyText = getString("replyText").trim().takeIf { it.isNotBlank() }?.take(4096) ?: return null
        )
    } catch (_: JSONException) {
        null
    }
}

private fun JSONObject.toNotificationDismissResultPayload(): NotificationDismissResultPayload? {
    return try {
        val errorCode = optString("errorCode").trim().takeIf { it.isNotBlank() }
        val message = optString("message").trim().takeIf { it.isNotBlank() }?.take(512)
        NotificationDismissResultPayload(
            notificationId = getString("notificationId").trim().takeIf { it.isNotBlank() } ?: return null,
            dismissed = optBoolean("dismissed", false),
            errorCode = errorCode,
            message = message
        )
    } catch (_: JSONException) {
        null
    }
}

private fun JSONObject.toNotificationReplyResultPayload(): NotificationReplyResultPayload? {
    return try {
        val errorCode = optString("errorCode").trim().takeIf { it.isNotBlank() }
        val message = optString("message").trim().takeIf { it.isNotBlank() }?.take(512)
        NotificationReplyResultPayload(
            notificationId = getString("notificationId").trim().takeIf { it.isNotBlank() } ?: return null,
            actionId = getString("actionId").trim().takeIf { it.isNotBlank() } ?: return null,
            replied = optBoolean("replied", false),
            errorCode = errorCode,
            message = message
        )
    } catch (_: JSONException) {
        null
    }
}
