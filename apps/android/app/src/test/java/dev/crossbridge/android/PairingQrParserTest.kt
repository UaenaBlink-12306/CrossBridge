package dev.crossbridge.android

import dev.crossbridge.android.protocol.PairingQrParseErrorCode
import dev.crossbridge.android.protocol.PairingQrParseResult
import dev.crossbridge.android.protocol.PairingQrParser
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.Base64
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingQrParserTest {
    @Test
    fun validQrPayloadParses() {
        val result = PairingQrParser.parse(validPayload().toString(), NOW_MS)

        assertTrue(result is PairingQrParseResult.Success)
        val payload = (result as PairingQrParseResult.Success).payload
        assertEquals("crossbridge-v1", payload.protocol)
        assertEquals("pairing_test_session", payload.pairingSessionId)
        assertEquals("ws://127.0.0.1:8787/connect", payload.relayUrl)
        assertEquals("pc_test_public_key", payload.pcPublicKey)
    }

    @Test
    fun urlEncodedQrPayloadParsesForDevPasteAutomation() {
        val encodedPayload = URLEncoder.encode(
            validPayload().toString(),
            StandardCharsets.UTF_8.name()
        )

        val result = PairingQrParser.parse(encodedPayload, NOW_MS)

        assertTrue(result is PairingQrParseResult.Success)
        val payload = (result as PairingQrParseResult.Success).payload
        assertEquals("pairing_test_session", payload.pairingSessionId)
    }

    @Test
    fun base64UrlQrPayloadParsesForDevPasteAutomation() {
        val encodedPayload = Base64.getUrlEncoder().withoutPadding().encodeToString(
            validPayload().toString().toByteArray(StandardCharsets.UTF_8)
        )

        val result = PairingQrParser.parse(encodedPayload, NOW_MS)

        assertTrue(result is PairingQrParseResult.Success)
        val payload = (result as PairingQrParseResult.Success).payload
        assertEquals("pairing_test_session", payload.pairingSessionId)
    }

    @Test
    fun invalidProtocolIsRejected() {
        val result = parseFailure(validPayload().put("protocol", "crossbridge-v2"))

        assertEquals(PairingQrParseErrorCode.INVALID_PROTOCOL, result.error.code)
    }

    @Test
    fun expiredPayloadIsRejected() {
        val result = parseFailure(validPayload().put("expiresAt", NOW_MS))

        assertEquals(PairingQrParseErrorCode.EXPIRED, result.error.code)
    }

    @Test
    fun missingPairingTokenIsRejected() {
        val payload = validPayload()
        payload.remove("pairingToken")

        val result = parseFailure(payload)

        assertEquals(PairingQrParseErrorCode.MISSING_FIELD, result.error.code)
    }

    @Test
    fun invalidRelayUrlIsRejected() {
        val result = parseFailure(validPayload().put("relayUrl", "https://relay.example/connect"))

        assertEquals(PairingQrParseErrorCode.INVALID_RELAY_URL, result.error.code)
    }

    @Test
    fun blankPcPublicKeyIsRejected() {
        val result = parseFailure(validPayload().put("pcPublicKey", " "))

        assertEquals(PairingQrParseErrorCode.INVALID_FIELD, result.error.code)
    }

    @Test
    fun compactJsonFromQrCodeParses() {
        // Compact single-line JSON as would be encoded in a scannable QR code
        val compactJson = "{\"protocol\":\"crossbridge-v1\"," +
            "\"pairingSessionId\":\"pairing_test_session\"," +
            "\"relayUrl\":\"ws://10.0.2.2:8787/connect\"," +
            "\"pcDeviceId\":\"pc_test_device\"," +
            "\"pcDeviceName\":\"Test PC\"," +
            "\"pcPublicKey\":\"pc_test_public_key\"," +
            "\"pairingToken\":\"pairing_test_token\"," +
            "\"expiresAt\":${NOW_MS + 60_000}}"

        val result = PairingQrParser.parse(compactJson, NOW_MS)

        assertTrue(result is PairingQrParseResult.Success)
        val payload = (result as PairingQrParseResult.Success).payload
        assertEquals("crossbridge-v1", payload.protocol)
        assertEquals("ws://10.0.2.2:8787/connect", payload.relayUrl)
        assertEquals("pairing_test_session", payload.pairingSessionId)
        assertEquals("pc_test_public_key", payload.pcPublicKey)
    }

    @Test
    fun malformedNonJsonTextIsRejected() {
        val result = PairingQrParser.parse("not a valid QR code at all", NOW_MS)

        assertTrue(result is PairingQrParseResult.Failure)
        assertEquals(
            PairingQrParseErrorCode.INVALID_JSON,
            (result as PairingQrParseResult.Failure).error.code
        )
    }

    private fun parseFailure(payload: JSONObject): PairingQrParseResult.Failure {
        val result = PairingQrParser.parse(payload.toString(), NOW_MS)
        assertTrue(result is PairingQrParseResult.Failure)
        return result as PairingQrParseResult.Failure
    }

    private fun validPayload(): JSONObject {
        return JSONObject()
            .put("protocol", "crossbridge-v1")
            .put("pairingSessionId", "pairing_test_session")
            .put("relayUrl", "ws://127.0.0.1:8787/connect")
            .put("pcDeviceId", "pc_test_device")
            .put("pcDeviceName", "Test PC")
            .put("pcPublicKey", "pc_test_public_key")
            .put("pairingToken", "pairing_test_token")
            .put("expiresAt", NOW_MS + 60_000)
    }

    private companion object {
        const val NOW_MS = 1_779_100_000_000L
    }
}
