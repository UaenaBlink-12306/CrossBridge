package dev.crossbridge.android

import dev.crossbridge.android.crypto.AppMessageCrypto
import dev.crossbridge.android.crypto.SecureAppMessage
import dev.crossbridge.android.network.ShareControlMessage
import dev.crossbridge.android.network.ShareSendStatus
import dev.crossbridge.android.network.ReplayProtector
import dev.crossbridge.android.network.addReceivedShare
import dev.crossbridge.android.network.addSendingShare
import dev.crossbridge.android.network.createTextShareAckEnvelope
import dev.crossbridge.android.network.createTextShareEnvelope
import dev.crossbridge.android.network.decodeShareEnvelope
import dev.crossbridge.android.network.detectContentType
import dev.crossbridge.android.network.isValidHttpUrl
import dev.crossbridge.android.network.markSentShareFailed
import dev.crossbridge.android.network.markSentShareReceived
import dev.crossbridge.android.network.markSentShareSent
import dev.crossbridge.android.protocol.TrustedDevice
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject

class ShareClientTest {
    @Test
    fun encryptsAndDecryptsAppMessages() {
        val pc = AppMessageCrypto.generateDevelopmentKeyPair()
        val android = AppMessageCrypto.generateDevelopmentKeyPair()
        val message = SecureAppMessage(
            id = "msg_roundtrip",
            type = "TEXT_SHARE",
            timestamp = 2_000L,
            fromDeviceId = "pc_xxx",
            toDeviceId = "android_xxx",
            payload = JSONObject().put("text", "hello")
        )

        val envelope = AppMessageCrypto.encrypt(
            message = message,
            localPrivateKey = pc.privateKey,
            localPublicKey = pc.publicKey,
            peerPublicKey = android.publicKey
        )
        val decrypted = AppMessageCrypto.decrypt(
            envelope = envelope,
            localDeviceId = "android_xxx",
            localPrivateKey = android.privateKey,
            localPublicKey = android.publicKey,
            peerPublicKey = pc.publicKey
        )

        assertEquals("msg_roundtrip", decrypted.id)
        assertEquals("hello", decrypted.payload.getString("text"))
    }

    @Test
    fun decryptFailsWithWrongKey() {
        val pc = AppMessageCrypto.generateDevelopmentKeyPair()
        val android = AppMessageCrypto.generateDevelopmentKeyPair()
        val stranger = AppMessageCrypto.generateDevelopmentKeyPair()
        val envelope = AppMessageCrypto.encrypt(
            message = SecureAppMessage(
                id = "msg_wrong_key",
                type = "TEXT_SHARE",
                timestamp = 2_000L,
                fromDeviceId = "pc_xxx",
                toDeviceId = "android_xxx",
                payload = JSONObject().put("text", "secret")
            ),
            localPrivateKey = pc.privateKey,
            localPublicKey = pc.publicKey,
            peerPublicKey = android.publicKey
        )

        assertThrowsAny {
            AppMessageCrypto.decrypt(
                envelope = envelope,
                localDeviceId = "android_xxx",
                localPrivateKey = stranger.privateKey,
                localPublicKey = stranger.publicKey,
                peerPublicKey = pc.publicKey
            )
        }
    }

    @Test
    fun detectsOnlyValidHttpUrls() {
        assertTrue(isValidHttpUrl("https://example.com/path?q=1"))
        assertTrue(isValidHttpUrl("HTTP://example.com"))
        assertFalse(isValidHttpUrl("https://exa mple.com"))
        assertFalse(isValidHttpUrl("ftp://example.com"))
        assertEquals("url", detectContentType("https://example.com"))
        assertEquals("text", detectContentType("www.example.com"))
    }

    @Test
    fun createsAndDecodesTextSharePayloads() {
        val android = AppMessageCrypto.generateDevelopmentKeyPair()
        val pc = AppMessageCrypto.generateDevelopmentKeyPair()
        val created = createTextShareEnvelope(
            fromDeviceId = "android_xxx",
            toDeviceId = "pc_xxx",
            text = "https://example.com",
            localPrivateKey = android.privateKey,
            localPublicKey = android.publicKey,
            peerPublicKey = pc.publicKey,
            now = 2_000L
        )
        val decoded = decodeShareEnvelope(
            message = created.envelope.toJson(),
            localDeviceId = "pc_xxx",
            localPrivateKey = pc.privateKey,
            localPublicKey = pc.publicKey,
            peerPublicKey = android.publicKey
        )

        assertEquals("url", created.payload.contentType)
        assertEquals("android_xxx", created.envelope.fromDeviceId)
        assertEquals("pc_xxx", created.envelope.toDeviceId)
        assertFalse(created.envelope.ciphertext.contains("https://example.com"))
        assertFalse(isBase64Json(created.envelope.ciphertext))
        assertTrue(decoded?.controlMessage is ShareControlMessage.TextShare)
    }

    @Test
    fun createsAndDecodesShareAcknowledgements() {
        val pc = AppMessageCrypto.generateDevelopmentKeyPair()
        val android = AppMessageCrypto.generateDevelopmentKeyPair()
        val ack = createTextShareAckEnvelope(
            fromDeviceId = "pc_xxx",
            toDeviceId = "android_xxx",
            shareId = "share_abc",
            localPrivateKey = pc.privateKey,
            localPublicKey = pc.publicKey,
            peerPublicKey = android.publicKey,
            now = 3_000L
        )
        val decoded = decodeShareEnvelope(
            message = ack.toJson(),
            localDeviceId = "android_xxx",
            localPrivateKey = android.privateKey,
            localPublicKey = android.publicKey,
            peerPublicKey = pc.publicKey
        )
        val control = decoded?.controlMessage as ShareControlMessage.Ack

        assertEquals("share_abc", control.payload.shareId)
        assertEquals("pc_xxx", control.payload.fromDeviceId)
        assertEquals("android_xxx", control.payload.toDeviceId)
        assertEquals(3_000L, control.payload.receivedAt)
    }

    @Test
    fun rejectsMalformedEncryptedEnvelope() {
        val android = AppMessageCrypto.generateDevelopmentKeyPair()
        val pc = AppMessageCrypto.generateDevelopmentKeyPair()
        val malformed = JSONObject()
            .put("version", 1)
            .put("fromDeviceId", "pc_xxx")
            .put("toDeviceId", "android_xxx")
            .put("messageId", "msg_bad")
            .put("timestamp", 2_000L)
            .put("nonce", "not-base64")
            .put("ciphertext", "not-base64")
            .put("algorithm", "ECDH-P256-HKDF-SHA256-AES-GCM")
            .put("keyId", "bad")

        val decoded = decodeShareEnvelope(
            message = malformed,
            localDeviceId = "android_xxx",
            localPrivateKey = android.privateKey,
            localPublicKey = android.publicKey,
            peerPublicKey = pc.publicKey
        )

        assertEquals(null, decoded)
    }

    @Test
    fun updatesShareHistoryHelpers() {
        val device = windowsDevice()
        val android = AppMessageCrypto.generateDevelopmentKeyPair()
        val pc = AppMessageCrypto.generateDevelopmentKeyPair()
        val created = createTextShareEnvelope(
            fromDeviceId = "android_xxx",
            toDeviceId = device.deviceId,
            text = "hello",
            localPrivateKey = android.privateKey,
            localPublicKey = android.publicKey,
            peerPublicKey = pc.publicKey,
            now = 1_000L
        )
        val sending = addSendingShare(
            sentShares = emptyList(),
            payload = created.payload,
            messageId = created.envelope.messageId,
            targetDevice = device
        )

        assertEquals(ShareSendStatus.SENDING, sending.single().status)
        assertEquals(ShareSendStatus.SENT, markSentShareSent(sending, created.envelope.messageId).single().status)
        assertEquals(ShareSendStatus.RECEIVED, markSentShareReceived(sending, created.payload.shareId).single().status)
        assertEquals(
            ShareSendStatus.FAILED,
            markSentShareFailed(sending, created.envelope.messageId, "Failed to send because the device is offline.")
                .single()
                .status
        )

        val received = addReceivedShare(
            receivedShares = emptyList(),
            share = dev.crossbridge.android.network.ReceivedShare(
                shareId = "share_in",
                messageId = "msg_in",
                sourceDevice = device,
                contentType = "text",
                text = "hello back",
                receivedAt = 2_000L
            )
        )

        assertEquals(1, received.size)
        assertEquals(1, addReceivedShare(received, received.single()).size)
    }

    @Test
    fun replayProtectorAcceptsEnvelopeOnce() {
        val android = AppMessageCrypto.generateDevelopmentKeyPair()
        val pc = AppMessageCrypto.generateDevelopmentKeyPair()
        val created = createTextShareEnvelope(
            fromDeviceId = "android_xxx",
            toDeviceId = "pc_xxx",
            text = "hello",
            localPrivateKey = android.privateKey,
            localPublicKey = android.publicKey,
            peerPublicKey = pc.publicKey,
            now = 2_000L
        )
        val protector = ReplayProtector()

        assertTrue(protector.accept(created.envelope))
        assertFalse(protector.accept(created.envelope))
    }

    private fun windowsDevice(): TrustedDevice {
        return TrustedDevice(
            deviceId = "pc_1",
            deviceName = "Windows PC",
            platform = "windows",
            publicKey = AppMessageCrypto.generateDevelopmentKeyPair().publicKey,
            pairedAt = 1_000L
        )
    }

    private fun isBase64Json(value: String): Boolean {
        return try {
            JSONObject(String(java.util.Base64.getDecoder().decode(value)))
            true
        } catch (_: Exception) {
            false
        }
    }

    private fun assertThrowsAny(block: () -> Unit) {
        var thrown = false
        try {
            block()
        } catch (_: Throwable) {
            thrown = true
        }
        assertTrue("Expected an exception.", thrown)
    }
}
