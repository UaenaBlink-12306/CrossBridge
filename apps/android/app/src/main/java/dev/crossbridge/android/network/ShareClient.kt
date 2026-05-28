package dev.crossbridge.android.network

import dev.crossbridge.android.crypto.AppMessageCrypto
import dev.crossbridge.android.crypto.SecureAppMessage
import dev.crossbridge.android.protocol.TrustedDevice
import dev.crossbridge.android.protocol.LanDiscoveryProbePayload
import java.net.URI
import java.util.UUID
import org.json.JSONException
import org.json.JSONObject

const val TEXT_SHARE_MAX_LENGTH = 20_000
const val TEXT_SHARE_TYPE = "TEXT_SHARE"
const val TEXT_SHARE_ACK_TYPE = "TEXT_SHARE_ACK"
const val TEXT_SHARE_ERROR_TYPE = "TEXT_SHARE_ERROR"
const val LAN_DISCOVERY_PROBE_TYPE = "LAN_DISCOVERY_PROBE"

data class RelayEnvelope(
    val version: Int = 1,
    val fromDeviceId: String,
    val toDeviceId: String,
    val messageId: String,
    val timestamp: Long,
    val nonce: String,
    val ciphertext: String,
    val algorithm: String? = null,
    val keyId: String? = null
) {
    fun toJson(): JSONObject {
        return JSONObject()
            .put("version", version)
            .put("fromDeviceId", fromDeviceId)
            .put("toDeviceId", toDeviceId)
            .put("messageId", messageId)
            .put("timestamp", timestamp)
            .put("nonce", nonce)
            .put("ciphertext", ciphertext)
            .also { json ->
                if (algorithm != null) json.put("algorithm", algorithm)
                if (keyId != null) json.put("keyId", keyId)
            }
    }
}

data class TextSharePayload(
    val shareId: String,
    val fromDeviceId: String,
    val toDeviceId: String,
    val contentType: String,
    val text: String,
    val createdAt: Long
)

data class TextShareAckPayload(
    val shareId: String,
    val fromDeviceId: String,
    val toDeviceId: String,
    val receivedAt: Long
)

data class TextShareErrorPayload(
    val shareId: String?,
    val fromDeviceId: String,
    val toDeviceId: String?,
    val errorCode: String,
    val message: String
)

sealed interface ShareControlMessage {
    data class TextShare(val payload: TextSharePayload) : ShareControlMessage
    data class Ack(val payload: TextShareAckPayload) : ShareControlMessage
    data class Error(val payload: TextShareErrorPayload) : ShareControlMessage
    data class LanDiscoveryProbe(val payload: LanDiscoveryProbePayload) : ShareControlMessage
}

data class CreatedTextShareEnvelope(
    val envelope: RelayEnvelope,
    val payload: TextSharePayload
)

data class DecodedShareEnvelope(
    val envelope: RelayEnvelope,
    val controlMessage: ShareControlMessage
)

enum class ShareSendStatus {
    SENDING,
    SENT,
    RECEIVED,
    FAILED
}

data class SentShare(
    val shareId: String,
    val messageId: String,
    val targetDevice: TrustedDevice,
    val contentType: String,
    val text: String,
    val createdAt: Long,
    val status: ShareSendStatus,
    val statusMessage: String
)

data class ReceivedShare(
    val shareId: String,
    val messageId: String,
    val sourceDevice: TrustedDevice,
    val contentType: String,
    val text: String,
    val receivedAt: Long
)

data class RelayAck(
    val messageId: String,
    val delivered: Boolean,
    val reason: String?
)

fun isValidHttpUrl(text: String): Boolean {
    val trimmed = text.trim()
    if (!trimmed.startsWith("http://", ignoreCase = true) &&
        !trimmed.startsWith("https://", ignoreCase = true)
    ) {
        return false
    }
    if (trimmed.any { it.isWhitespace() }) return false

    return try {
        val uri = URI(trimmed)
        val scheme = uri.scheme?.lowercase()
        (scheme == "http" || scheme == "https") && !uri.host.isNullOrBlank()
    } catch (_: Exception) {
        false
    }
}

fun detectContentType(text: String): String {
    return if (isValidHttpUrl(text)) "url" else "text"
}

fun createTextShareEnvelope(
    fromDeviceId: String,
    toDeviceId: String,
    text: String,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String,
    now: Long = System.currentTimeMillis()
): CreatedTextShareEnvelope {
    require(text.trim().isNotEmpty()) { "text must not be blank" }
    require(text.length <= TEXT_SHARE_MAX_LENGTH) { "text is longer than $TEXT_SHARE_MAX_LENGTH characters" }

    val payload = TextSharePayload(
        shareId = randomId("share"),
        fromDeviceId = fromDeviceId,
        toDeviceId = toDeviceId,
        contentType = detectContentType(text),
        text = text,
        createdAt = now
    )
    val envelope = createRelayPayloadEnvelope(
        fromDeviceId = fromDeviceId,
        toDeviceId = toDeviceId,
        controlMessage = JSONObject()
            .put("type", TEXT_SHARE_TYPE)
            .put("payload", payload.toJson()),
        now = now,
        localPrivateKey = localPrivateKey,
        localPublicKey = localPublicKey,
        peerPublicKey = peerPublicKey
    )
    return CreatedTextShareEnvelope(envelope = envelope, payload = payload)
}

fun createTextShareAckEnvelope(
    fromDeviceId: String,
    toDeviceId: String,
    shareId: String,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String,
    now: Long = System.currentTimeMillis()
): RelayEnvelope {
    val payload = TextShareAckPayload(
        shareId = shareId,
        fromDeviceId = fromDeviceId,
        toDeviceId = toDeviceId,
        receivedAt = now
    )
    return createRelayPayloadEnvelope(
        fromDeviceId = fromDeviceId,
        toDeviceId = toDeviceId,
        controlMessage = JSONObject()
            .put("type", TEXT_SHARE_ACK_TYPE)
            .put("payload", payload.toJson()),
        now = now,
        localPrivateKey = localPrivateKey,
        localPublicKey = localPublicKey,
        peerPublicKey = peerPublicKey
    )
}

fun decodeShareEnvelope(
    message: JSONObject,
    localDeviceId: String,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String
): DecodedShareEnvelope? {
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

    val controlJson = JSONObject()
        .put("type", appMessage.type)
        .put("payload", appMessage.payload)
    val payload = controlJson.optJSONObject("payload") ?: return null
    val controlMessage = when (controlJson.optString("type")) {
        TEXT_SHARE_TYPE -> ShareControlMessage.TextShare(payload.toTextSharePayload() ?: return null)
        TEXT_SHARE_ACK_TYPE -> ShareControlMessage.Ack(payload.toTextShareAckPayload() ?: return null)
        TEXT_SHARE_ERROR_TYPE -> ShareControlMessage.Error(payload.toTextShareErrorPayload() ?: return null)
        LAN_DISCOVERY_PROBE_TYPE -> ShareControlMessage.LanDiscoveryProbe(payload.toLanDiscoveryProbePayload() ?: return null)
        else -> return null
    }

    return DecodedShareEnvelope(envelope = envelope, controlMessage = controlMessage)
}

fun parseRelayAck(message: JSONObject): RelayAck? {
    if (message.optString("type") != "RELAY_ACK") return null
    val messageId = message.optString("messageId").trim().takeIf { it.isNotBlank() } ?: return null
    if (!message.has("delivered")) return null
    return RelayAck(
        messageId = messageId,
        delivered = message.optBoolean("delivered", false),
        reason = message.optString("reason").trim().takeIf { it.isNotBlank() }
    )
}

fun relayAckFailureMessage(reason: String?): String {
    return when (reason) {
        "DEVICE_OFFLINE", "SOCKET_CLOSED" -> "Failed to send because the device is offline."
        "UNTRUSTED_DEVICE" -> "Failed to send because the device is not trusted yet."
        else -> "Failed to send through the relay."
    }
}

fun addSendingShare(
    sentShares: List<SentShare>,
    payload: TextSharePayload,
    messageId: String,
    targetDevice: TrustedDevice
): List<SentShare> {
    return listOf(
        SentShare(
            shareId = payload.shareId,
            messageId = messageId,
            targetDevice = targetDevice,
            contentType = payload.contentType,
            text = payload.text,
            createdAt = payload.createdAt,
            status = ShareSendStatus.SENDING,
            statusMessage = "Sending..."
        )
    ).plus(sentShares).take(SHARE_HISTORY_LIMIT)
}

fun markSentShareSent(sentShares: List<SentShare>, messageId: String): List<SentShare> {
    return sentShares.map { share ->
        if (share.messageId != messageId) share else share.copy(
            status = ShareSendStatus.SENT,
            statusMessage = "Sent."
        )
    }
}

fun markSentShareReceived(sentShares: List<SentShare>, shareId: String): List<SentShare> {
    return sentShares.map { share ->
        if (share.shareId != shareId) share else share.copy(
            status = ShareSendStatus.RECEIVED,
            statusMessage = "Received."
        )
    }
}

fun markSentShareFailed(
    sentShares: List<SentShare>,
    messageIdOrShareId: String,
    statusMessage: String
): List<SentShare> {
    return sentShares.map { share ->
        if (share.messageId != messageIdOrShareId && share.shareId != messageIdOrShareId) {
            share
        } else {
            share.copy(status = ShareSendStatus.FAILED, statusMessage = statusMessage)
        }
    }
}

fun markMostRecentSendingShareFailed(
    sentShares: List<SentShare>,
    statusMessage: String
): List<SentShare> {
    var updated = false
    return sentShares.map { share ->
        if (updated || share.status != ShareSendStatus.SENDING) {
            share
        } else {
            updated = true
            share.copy(status = ShareSendStatus.FAILED, statusMessage = statusMessage)
        }
    }
}

fun addReceivedShare(
    receivedShares: List<ReceivedShare>,
    share: ReceivedShare
): List<ReceivedShare> {
    if (receivedShares.any { it.shareId == share.shareId }) return receivedShares
    return listOf(share).plus(receivedShares).take(SHARE_HISTORY_LIMIT)
}

private const val SHARE_HISTORY_LIMIT = 20

internal fun createRelayPayloadEnvelope(
    fromDeviceId: String,
    toDeviceId: String,
    controlMessage: JSONObject,
    now: Long,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String
): RelayEnvelope {
    val message = SecureAppMessage(
        id = randomId("msg"),
        type = controlMessage.getString("type"),
        timestamp = now,
        fromDeviceId = fromDeviceId,
        toDeviceId = toDeviceId,
        payload = controlMessage.getJSONObject("payload")
    )
    return AppMessageCrypto.encrypt(
        message = message,
        localPrivateKey = localPrivateKey,
        localPublicKey = localPublicKey,
        peerPublicKey = peerPublicKey
    ).toRelayEnvelope() ?: error("Encrypted envelope was invalid.")
}

private fun randomId(prefix: String): String {
    return "${prefix}_${UUID.randomUUID().toString().replace("-", "")}"
}

internal fun JSONObject.toRelayEnvelope(): RelayEnvelope? {
    if (optInt("version") != 1) return null
    return try {
        RelayEnvelope(
            fromDeviceId = getString("fromDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
            toDeviceId = getString("toDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
            messageId = getString("messageId").trim().takeIf { it.isNotBlank() } ?: return null,
            timestamp = getLong("timestamp"),
            nonce = getString("nonce").trim().takeIf { it.isNotBlank() } ?: return null,
            ciphertext = getString("ciphertext").trim().takeIf { it.isNotBlank() } ?: return null,
            algorithm = optString("algorithm").trim().takeIf { it.isNotBlank() },
            keyId = optString("keyId").trim().takeIf { it.isNotBlank() }
        )
    } catch (_: JSONException) {
        null
    }
}

private fun JSONObject.toTextSharePayload(): TextSharePayload? {
    return try {
        val text = getString("text")
        val contentType = getString("contentType")
        if (text.trim().isEmpty() || text.length > TEXT_SHARE_MAX_LENGTH) return null
        if (contentType != "text" && contentType != "url") return null
        if (contentType == "url" && !isValidHttpUrl(text)) return null

        TextSharePayload(
            shareId = getString("shareId").trim().takeIf { it.isNotBlank() } ?: return null,
            fromDeviceId = getString("fromDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
            toDeviceId = getString("toDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
            contentType = contentType,
            text = text,
            createdAt = getLong("createdAt")
        )
    } catch (_: JSONException) {
        null
    }
}

private fun JSONObject.toTextShareAckPayload(): TextShareAckPayload? {
    return try {
        TextShareAckPayload(
            shareId = getString("shareId").trim().takeIf { it.isNotBlank() } ?: return null,
            fromDeviceId = getString("fromDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
            toDeviceId = getString("toDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
            receivedAt = getLong("receivedAt")
        )
    } catch (_: JSONException) {
        null
    }
}

private fun JSONObject.toTextShareErrorPayload(): TextShareErrorPayload? {
    return try {
        TextShareErrorPayload(
            shareId = optString("shareId").trim().takeIf { it.isNotBlank() },
            fromDeviceId = getString("fromDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
            toDeviceId = optString("toDeviceId").trim().takeIf { it.isNotBlank() },
            errorCode = getString("errorCode").trim().takeIf { it.isNotBlank() } ?: return null,
            message = getString("message").trim().takeIf { it.isNotBlank() } ?: return null
        )
    } catch (_: JSONException) {
        null
    }
}

private fun TextSharePayload.toJson(): JSONObject {
    return JSONObject()
        .put("shareId", shareId)
        .put("fromDeviceId", fromDeviceId)
        .put("toDeviceId", toDeviceId)
        .put("contentType", contentType)
        .put("text", text)
        .put("createdAt", createdAt)
}


private fun TextShareAckPayload.toJson(): JSONObject {
    return JSONObject()
        .put("shareId", shareId)
        .put("fromDeviceId", fromDeviceId)
        .put("toDeviceId", toDeviceId)
        .put("receivedAt", receivedAt)
}

fun createLanDiscoveryProbeEnvelope(
    fromDeviceId: String,
    toDeviceId: String,
    localIps: List<String>,
    port: Int,
    isReachable: Boolean,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String,
    now: Long = System.currentTimeMillis()
): RelayEnvelope {
    val payload = LanDiscoveryProbePayload(
        deviceId = fromDeviceId,
        localIps = localIps,
        port = port,
        timestamp = now,
        isReachable = isReachable
    )
    return createRelayPayloadEnvelope(
        fromDeviceId = fromDeviceId,
        toDeviceId = toDeviceId,
        controlMessage = JSONObject()
            .put("type", LAN_DISCOVERY_PROBE_TYPE)
            .put("payload", payload.toJson()),
        now = now,
        localPrivateKey = localPrivateKey,
        localPublicKey = localPublicKey,
        peerPublicKey = peerPublicKey
    )
}

private fun JSONObject.toLanDiscoveryProbePayload(): LanDiscoveryProbePayload? {
    return try {
        val ipsJson = optJSONArray("localIps") ?: org.json.JSONArray()
        val localIps = ArrayList<String>()
        for (i in 0 until ipsJson.length()) {
            localIps.add(ipsJson.getString(i))
        }
        LanDiscoveryProbePayload(
            deviceId = getString("deviceId").trim().takeIf { it.isNotBlank() } ?: return null,
            localIps = localIps,
            port = getInt("port"),
            timestamp = getLong("timestamp"),
            isReachable = optBoolean("isReachable", false)
        )
    } catch (_: org.json.JSONException) {
        null
    }
}

private fun LanDiscoveryProbePayload.toJson(): JSONObject {
    val ipsJson = org.json.JSONArray()
    localIps.forEach { ipsJson.put(it) }
    return JSONObject()
        .put("deviceId", deviceId)
        .put("localIps", ipsJson)
        .put("port", port)
        .put("timestamp", timestamp)
        .put("isReachable", isReachable)
}

