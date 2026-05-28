package dev.crossbridge.android

import dev.crossbridge.android.crypto.AppMessageCrypto
import dev.crossbridge.android.network.NotificationPostedPayload
import dev.crossbridge.android.network.NotificationDismissPayload
import dev.crossbridge.android.network.NotificationDismissResultPayload
import dev.crossbridge.android.network.NotificationReplyPayload
import dev.crossbridge.android.network.NotificationReplyResultPayload
import dev.crossbridge.android.network.NotificationRemovedPayload
import dev.crossbridge.android.network.createNotificationDismissEnvelope
import dev.crossbridge.android.network.createNotificationDismissResultEnvelope
import dev.crossbridge.android.network.createNotificationPostedEnvelope
import dev.crossbridge.android.network.createNotificationReplyEnvelope
import dev.crossbridge.android.network.createNotificationReplyResultEnvelope
import dev.crossbridge.android.network.createNotificationRemovedEnvelope
import dev.crossbridge.android.network.decodeNotificationEnvelope
import dev.crossbridge.android.network.toNotificationPostedPayload
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.json.JSONObject

class NotificationMirrorClientTest {
    @Test
    fun createsNotificationPostedEnvelope() {
        val android = AppMessageCrypto.generateDevelopmentKeyPair()
        val pc = AppMessageCrypto.generateDevelopmentKeyPair()
        val payload = NotificationPostedPayload(
            notificationId = "notif_1",
            packageName = "com.example",
            appName = "Example",
            title = "Greeting",
            text = "Encrypted body",
            subText = null,
            postTime = 2_000L,
            canDismiss = true,
            actions = emptyList()
        )

        val envelope = createNotificationPostedEnvelope(
            fromDeviceId = "android_xxx",
            toDeviceId = "pc_xxx",
            payload = payload,
            localPrivateKey = android.privateKey,
            localPublicKey = android.publicKey,
            peerPublicKey = pc.publicKey,
            now = 2_500L
        )
        val decrypted = AppMessageCrypto.decrypt(
            envelope = envelope.toJson(),
            localDeviceId = "pc_xxx",
            localPrivateKey = pc.privateKey,
            localPublicKey = pc.publicKey,
            peerPublicKey = android.publicKey
        )

        assertEquals("NOTIFICATION_POSTED", decrypted.type)
        assertEquals("notif_1", decrypted.payload.getString("notificationId"))
        assertFalse(envelope.ciphertext.contains("Encrypted body"))
    }

    @Test
    fun parsesPostedPayloadAndCreatesRemovedEnvelope() {
        val parsed = JSONObject()
            .put("notificationId", "notif_1")
            .put("packageName", "com.example")
            .put("appName", "Example")
            .put("title", "Greeting")
            .put("text", "Body")
            .put("subText", JSONObject.NULL)
            .put("postTime", 2_000L)
            .put("canDismiss", true)
            .put("actions", org.json.JSONArray())
            .toNotificationPostedPayload()

        assertEquals("Example", parsed?.appName)

        val android = AppMessageCrypto.generateDevelopmentKeyPair()
        val pc = AppMessageCrypto.generateDevelopmentKeyPair()
        val envelope = createNotificationRemovedEnvelope(
            fromDeviceId = "android_xxx",
            toDeviceId = "pc_xxx",
            payload = NotificationRemovedPayload("notif_1"),
            localPrivateKey = android.privateKey,
            localPublicKey = android.publicKey,
            peerPublicKey = pc.publicKey,
            now = 3_000L
        )
        val decrypted = AppMessageCrypto.decrypt(
            envelope = envelope.toJson(),
            localDeviceId = "pc_xxx",
            localPrivateKey = pc.privateKey,
            localPublicKey = pc.publicKey,
            peerPublicKey = android.publicKey
        )

        assertEquals("NOTIFICATION_REMOVED", decrypted.type)
        assertEquals("notif_1", decrypted.payload.getString("notificationId"))
    }

    @Test
    fun createsDismissRequestAndResultEnvelopes() {
        val android = AppMessageCrypto.generateDevelopmentKeyPair()
        val pc = AppMessageCrypto.generateDevelopmentKeyPair()

        val dismissEnvelope = createNotificationDismissEnvelope(
            fromDeviceId = "pc_xxx",
            toDeviceId = "android_xxx",
            payload = NotificationDismissPayload("notif_1"),
            localPrivateKey = pc.privateKey,
            localPublicKey = pc.publicKey,
            peerPublicKey = android.publicKey,
            now = 3_100L
        )

        val decodedDismiss = decodeNotificationEnvelope(
            message = dismissEnvelope.toJson(),
            localDeviceId = "android_xxx",
            localPrivateKey = android.privateKey,
            localPublicKey = android.publicKey,
            peerPublicKey = pc.publicKey
        )

        assertNotNull(decodedDismiss)
        assertEquals("notif_1", (decodedDismiss?.controlMessage as dev.crossbridge.android.network.NotificationControlMessage.Dismiss).payload.notificationId)

        val resultEnvelope = createNotificationDismissResultEnvelope(
            fromDeviceId = "android_xxx",
            toDeviceId = "pc_xxx",
            payload = NotificationDismissResultPayload(
                notificationId = "notif_1",
                dismissed = false,
                errorCode = "PERMISSION_MISSING",
                message = "Notification access is not active on Android right now."
            ),
            localPrivateKey = android.privateKey,
            localPublicKey = android.publicKey,
            peerPublicKey = pc.publicKey,
            now = 3_200L
        )

        val decodedResult = decodeNotificationEnvelope(
            message = resultEnvelope.toJson(),
            localDeviceId = "pc_xxx",
            localPrivateKey = pc.privateKey,
            localPublicKey = pc.publicKey,
            peerPublicKey = android.publicKey
        )

        assertNotNull(decodedResult)
        val resultPayload = (decodedResult?.controlMessage as dev.crossbridge.android.network.NotificationControlMessage.DismissResult).payload
        assertEquals(false, resultPayload.dismissed)
        assertEquals("PERMISSION_MISSING", resultPayload.errorCode)
    }

    @Test
    fun createsReplyRequestAndResultEnvelopes() {
        val android = AppMessageCrypto.generateDevelopmentKeyPair()
        val pc = AppMessageCrypto.generateDevelopmentKeyPair()

        val replyEnvelope = createNotificationReplyEnvelope(
            fromDeviceId = "pc_xxx",
            toDeviceId = "android_xxx",
            payload = NotificationReplyPayload(
                notificationId = "notif_1",
                actionId = "action_0",
                replyText = "On my way."
            ),
            localPrivateKey = pc.privateKey,
            localPublicKey = pc.publicKey,
            peerPublicKey = android.publicKey,
            now = 3_150L
        )

        val decodedReply = decodeNotificationEnvelope(
            message = replyEnvelope.toJson(),
            localDeviceId = "android_xxx",
            localPrivateKey = android.privateKey,
            localPublicKey = android.publicKey,
            peerPublicKey = pc.publicKey
        )

        assertNotNull(decodedReply)
        val replyPayload = (decodedReply?.controlMessage as dev.crossbridge.android.network.NotificationControlMessage.Reply).payload
        assertEquals("notif_1", replyPayload.notificationId)
        assertEquals("action_0", replyPayload.actionId)
        assertEquals("On my way.", replyPayload.replyText)

        val replyResultEnvelope = createNotificationReplyResultEnvelope(
            fromDeviceId = "android_xxx",
            toDeviceId = "pc_xxx",
            payload = NotificationReplyResultPayload(
                notificationId = "notif_1",
                actionId = "action_0",
                replied = false,
                errorCode = "NOTIFICATION_REPLY_UNSUPPORTED",
                message = "Android no longer exposes a reply action for this notification."
            ),
            localPrivateKey = android.privateKey,
            localPublicKey = android.publicKey,
            peerPublicKey = pc.publicKey,
            now = 3_250L
        )

        val decodedReplyResult = decodeNotificationEnvelope(
            message = replyResultEnvelope.toJson(),
            localDeviceId = "pc_xxx",
            localPrivateKey = pc.privateKey,
            localPublicKey = pc.publicKey,
            peerPublicKey = android.publicKey
        )

        assertNotNull(decodedReplyResult)
        val replyResultPayload =
            (decodedReplyResult?.controlMessage as dev.crossbridge.android.network.NotificationControlMessage.ReplyResult).payload
        assertEquals(false, replyResultPayload.replied)
        assertEquals("action_0", replyResultPayload.actionId)
        assertEquals("NOTIFICATION_REPLY_UNSUPPORTED", replyResultPayload.errorCode)
    }
}
