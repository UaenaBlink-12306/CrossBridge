package dev.crossbridge.android.protocol

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Base64
import org.json.JSONException
import org.json.JSONObject

enum class PairingQrParseErrorCode {
    INVALID_JSON,
    MISSING_FIELD,
    INVALID_PROTOCOL,
    INVALID_RELAY_URL,
    INVALID_FIELD,
    EXPIRED
}

data class PairingQrParseError(
    val code: PairingQrParseErrorCode,
    val message: String
)

sealed class PairingQrParseResult {
    data class Success(val payload: PairingQrPayload) : PairingQrParseResult()
    data class Failure(val error: PairingQrParseError) : PairingQrParseResult()
}

object PairingQrParser {
    fun parse(
        rawJson: String,
        nowMs: Long = System.currentTimeMillis()
    ): PairingQrParseResult {
        val normalizedInput = rawJson.trim().removePrefix("\uFEFF")
        val json = parseJsonObject(normalizedInput)
            ?: parseJsonObject(urlDecode(normalizedInput))
            ?: parseJsonObject(base64UrlDecode(normalizedInput))
        if (json == null) {
            return failure(
                PairingQrParseErrorCode.INVALID_JSON,
                "QR payload must be valid CrossBridge JSON."
            )
        }

        val protocol = requiredString(json, "protocol") ?: return missing("protocol")
        if (protocol != "crossbridge-v1") {
            return failure(
                PairingQrParseErrorCode.INVALID_PROTOCOL,
                "QR payload protocol must be crossbridge-v1."
            )
        }

        val pairingSessionId = requiredString(json, "pairingSessionId")
            ?: return missing("pairingSessionId")
        val relayUrl = requiredString(json, "relayUrl") ?: return missing("relayUrl")
        val pcDeviceId = requiredString(json, "pcDeviceId") ?: return missing("pcDeviceId")
        val pcDeviceName = requiredString(json, "pcDeviceName") ?: return missing("pcDeviceName")
        val pcPublicKey = requiredString(json, "pcPublicKey") ?: return missing("pcPublicKey")
        val pairingToken = requiredString(json, "pairingToken") ?: return missing("pairingToken")
        val expiresAt = requiredLong(json, "expiresAt") ?: return missing("expiresAt")

        if (!isRelayUrlValid(relayUrl)) {
            return failure(
                PairingQrParseErrorCode.INVALID_RELAY_URL,
                "Relay URL must start with ws:// or wss://."
            )
        }

        val blankField = listOf(
            "pairingSessionId" to pairingSessionId,
            "pcDeviceId" to pcDeviceId,
            "pcDeviceName" to pcDeviceName,
            "pcPublicKey" to pcPublicKey,
            "pairingToken" to pairingToken
        ).firstOrNull { (_, value) -> value.isBlank() }

        if (blankField != null) {
            return failure(
                PairingQrParseErrorCode.INVALID_FIELD,
                "${blankField.first} must not be blank."
            )
        }

        if (expiresAt <= nowMs) {
            return failure(
                PairingQrParseErrorCode.EXPIRED,
                "Pairing code has expired. Create a new code on Windows."
            )
        }

        return PairingQrParseResult.Success(
            PairingQrPayload(
                protocol = protocol,
                pairingSessionId = pairingSessionId,
                relayUrl = relayUrl,
                pcDeviceId = pcDeviceId,
                pcDeviceName = pcDeviceName,
                pcPublicKey = pcPublicKey,
                pairingToken = pairingToken,
                expiresAt = expiresAt
            )
        )
    }

    private fun parseJsonObject(value: String): JSONObject? {
        return try {
            JSONObject(value)
        } catch (_: JSONException) {
            null
        }
    }

    private fun urlDecode(value: String): String {
        return try {
            URLDecoder.decode(value, StandardCharsets.UTF_8.name())
        } catch (_: IllegalArgumentException) {
            value
        }
    }

    private fun base64UrlDecode(value: String): String {
        return try {
            val padding = "=".repeat((4 - value.length % 4) % 4)
            String(Base64.getUrlDecoder().decode(value + padding), StandardCharsets.UTF_8)
        } catch (_: IllegalArgumentException) {
            value
        }
    }

    private fun requiredString(json: JSONObject, field: String): String? {
        if (!json.has(field) || json.isNull(field)) return null
        val value = json.opt(field)
        return if (value is String) value.trim() else ""
    }

    private fun requiredLong(json: JSONObject, field: String): Long? {
        if (!json.has(field) || json.isNull(field)) return null
        return try {
            json.getLong(field)
        } catch (_: JSONException) {
            null
        }
    }

    private fun missing(field: String): PairingQrParseResult.Failure {
        return failure(
            PairingQrParseErrorCode.MISSING_FIELD,
            "QR payload is missing $field."
        )
    }

    private fun isRelayUrlValid(relayUrl: String): Boolean {
        return try {
            val uri = URI(relayUrl)
            (uri.scheme == "ws" || uri.scheme == "wss") && !uri.host.isNullOrBlank()
        } catch (_: IllegalArgumentException) {
            false
        }
    }

    private fun failure(
        code: PairingQrParseErrorCode,
        message: String
    ): PairingQrParseResult.Failure {
        return PairingQrParseResult.Failure(PairingQrParseError(code, message))
    }
}
