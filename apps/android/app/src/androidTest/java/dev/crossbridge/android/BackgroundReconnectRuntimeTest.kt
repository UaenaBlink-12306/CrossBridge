package dev.crossbridge.android

import android.content.Context
import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.crossbridge.android.crypto.AppMessageCrypto
import dev.crossbridge.android.crypto.DevelopmentKeyPair
import dev.crossbridge.android.network.ConnectionManager
import dev.crossbridge.android.network.NotificationControlMessage
import dev.crossbridge.android.network.NotificationPostedPayload
import dev.crossbridge.android.network.NOTIFICATION_POSTED_TYPE
import dev.crossbridge.android.network.RelayClient
import dev.crossbridge.android.network.parseRelayAck
import dev.crossbridge.android.network.ShareControlMessage
import dev.crossbridge.android.network.TEXT_SHARE_ACK_TYPE
import dev.crossbridge.android.network.createTextShareEnvelope
import dev.crossbridge.android.network.decodeNotificationEnvelope
import dev.crossbridge.android.network.decodeShareEnvelope
import dev.crossbridge.android.protocol.DeviceIdentity
import dev.crossbridge.android.protocol.TrustedDevice
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BackgroundReconnectRuntimeTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val targetContext = instrumentation.targetContext
    private val app = targetContext.applicationContext as CrossBridgeApplication
    private lateinit var androidKeys: DevelopmentKeyPair
    private lateinit var androidIdentity: DeviceIdentity
    private lateinit var windowsKeys: DevelopmentKeyPair
    private lateinit var windowsIdentity: DeviceIdentity
    private lateinit var windowsPeer: FakeWindowsPeer

    @Before
    fun setUp() {
        androidKeys = AppMessageCrypto.generateDevelopmentKeyPair()
        windowsKeys = AppMessageCrypto.generateDevelopmentKeyPair()
        androidIdentity = DeviceIdentity(
            deviceId = "android_runtime_bg",
            deviceName = "CrossBridge Runtime Android",
            platform = "android",
            publicKey = androidKeys.publicKey
        )
        windowsIdentity = DeviceIdentity(
            deviceId = "windows_runtime_bg",
            deviceName = "CrossBridge Runtime Windows",
            platform = "windows",
            publicKey = windowsKeys.publicKey
        )

        seedRuntimeState()
        shell("pm grant ${targetContext.packageName} android.permission.POST_NOTIFICATIONS")
        shell("pm grant $HELPER_PACKAGE android.permission.POST_NOTIFICATIONS")
        shell("cmd notification allow_listener ${listenerComponentName()}")
        shell("am force-stop $HELPER_PACKAGE")

        app.connectionManager.refreshAfterPairingComplete()
        launchApp()
        waitForNotificationListener()
        windowsPeer = FakeWindowsPeer(
            relayUrl = RELAY_URL,
            windowsIdentity = windowsIdentity,
            windowsPrivateKey = windowsKeys.privateKey,
            androidIdentity = androidIdentity,
            androidPublicKey = androidKeys.publicKey
        )
        windowsPeer.connectAndAnnounce()
        waitForTrustedDeviceOnline(app.connectionManager, windowsIdentity.deviceId)
    }

    @After
    fun tearDown() {
        if (::windowsPeer.isInitialized) {
            windowsPeer.close()
        }
        shell("am force-stop $HELPER_PACKAGE")
        shell("cmd notification disallow_listener ${listenerComponentName()}")
    }

    @Test
    fun appKeepsRelayShareAndNotificationHandlingAcrossBackgroundAndReopen() {
        shell("input keyevent 3")
        waitForTrustedDeviceOnline(app.connectionManager, windowsIdentity.deviceId)

        val firstAck = windowsPeer.sendTextShareAndAwaitAck("background relay share")
        assertEquals(androidIdentity.deviceId, firstAck.fromDeviceId)
        assertEquals(windowsIdentity.deviceId, firstAck.toDeviceId)

        val mirroredNotification = windowsPeer.awaitNotificationPosted {
            launchHelperApp()
        }
        assertEquals(HELPER_PACKAGE, mirroredNotification.packageName)
        assertTrue(mirroredNotification.actions.any { it.supportsRemoteInput })

        windowsPeer.disconnect()
        waitForTrustedDeviceOffline(app.connectionManager, windowsIdentity.deviceId)

        windowsPeer.connectAndAnnounce()
        waitForTrustedDeviceOnline(app.connectionManager, windowsIdentity.deviceId)

        launchApp()

        val secondAck = windowsPeer.sendTextShareAndAwaitAck("reopened relay share")
        assertEquals(androidIdentity.deviceId, secondAck.fromDeviceId)
        assertEquals(windowsIdentity.deviceId, secondAck.toDeviceId)
    }

    private fun seedRuntimeState() {
        targetContext.getSharedPreferences("crossbridge_relay_settings", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .putString("relayUrl", RELAY_URL)
            .commit()

        targetContext.getSharedPreferences("crossbridge_trusted_devices", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .putString(
                "trustedDevices",
                JSONArray()
                    .put(
                        JSONObject()
                            .put("deviceId", windowsIdentity.deviceId)
                            .put("deviceName", windowsIdentity.deviceName)
                            .put("platform", windowsIdentity.platform)
                            .put("publicKey", windowsIdentity.publicKey)
                            .put("pairedAt", SEEDED_TIMESTAMP)
                            .put("lastSeenAt", SEEDED_TIMESTAMP)
                    )
                    .toString()
            )
            .commit()

        targetContext.getSharedPreferences("crossbridge_android_identity", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .putString("deviceId", androidIdentity.deviceId)
            .putString("deviceName", androidIdentity.deviceName)
            .putString("platform", androidIdentity.platform)
            .putString("publicKey", androidIdentity.publicKey)
            .putString("privateKey", androidKeys.privateKey)
            .commit()

        targetContext.getSharedPreferences("crossbridge_android_identity_secrets", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
    }

    private fun launchApp() {
        val launchIntent = targetContext.packageManager.getLaunchIntentForPackage(targetContext.packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ?: error("CrossBridge launch intent was unavailable.")
        targetContext.startActivity(launchIntent)
        instrumentation.waitForIdleSync()
        Thread.sleep(1_000L)
    }

    private fun launchHelperApp() {
        shell("logcat -c")
        val launchIntent = Intent()
            .setClassName(HELPER_PACKAGE, "$HELPER_PACKAGE.MainActivity")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        targetContext.startActivity(launchIntent)
        instrumentation.waitForIdleSync()
    }

    private fun waitForNotificationListener(timeoutMs: Long = 15_000L) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (isNotificationListenerEnabled(targetContext)) {
                val probe = CrossBridgeNotificationListenerService.replyToMirroredNotification(
                    notificationId = "probe_notification",
                    actionId = "action_0",
                    replyText = "probe"
                )
                if (!probe.replied && probe.errorCode != "PERMISSION_MISSING") {
                    return
                }
            }
            Thread.sleep(250L)
        }
        throw AssertionError("CrossBridge notification listener did not become active in time.")
    }

    private fun waitForTrustedDeviceOnline(
        connectionManager: ConnectionManager,
        deviceId: String,
        timeoutMs: Long = 15_000L
    ) {
        waitForTrustedDeviceState(connectionManager, deviceId, online = true, timeoutMs = timeoutMs)
    }

    private fun waitForTrustedDeviceOffline(
        connectionManager: ConnectionManager,
        deviceId: String,
        timeoutMs: Long = 15_000L
    ) {
        waitForTrustedDeviceState(connectionManager, deviceId, online = false, timeoutMs = timeoutMs)
    }

    private fun waitForTrustedDeviceState(
        connectionManager: ConnectionManager,
        deviceId: String,
        online: Boolean,
        timeoutMs: Long
    ) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val match = connectionManager.viewState.value.trustedDevices
                .firstOrNull { it.device.deviceId == deviceId }
            if (match != null && match.online == online) {
                return
            }
            Thread.sleep(250L)
        }
        throw AssertionError("Timed out waiting for trusted device $deviceId to become online=$online")
    }

    private fun listenerComponentName(): String {
        return "${targetContext.packageName}/${CrossBridgeNotificationListenerService::class.java.name}"
    }

    private fun shell(command: String): String {
        val descriptor = instrumentation.uiAutomation.executeShellCommand(command)
        return descriptor.use { fileDescriptor ->
            BufferedReader(
                InputStreamReader(android.os.ParcelFileDescriptor.AutoCloseInputStream(fileDescriptor))
            ).use { reader ->
                reader.readText()
            }
        }
    }

    private class FakeWindowsPeer(
        private val relayUrl: String,
        private val windowsIdentity: DeviceIdentity,
        private val windowsPrivateKey: String,
        private val androidIdentity: DeviceIdentity,
        private val androidPublicKey: String
    ) {
        private val relayClient = RelayClient()
        private val inbox = LinkedBlockingQueue<JSONObject>()
        private val backlog = mutableListOf<JSONObject>()
        private val unsubscribeMessages = relayClient.onMessage { message ->
            inbox.offer(message)
        }

        fun connectAndAnnounce() {
            runBlocking {
                relayClient.connect(relayUrl)
                relayClient.send(
                    JSONObject()
                        .put("type", "RELAY_HELLO")
                        .put("deviceId", windowsIdentity.deviceId)
                        .put("sessionToken", "runtime_${windowsIdentity.deviceId}_${System.currentTimeMillis()}")
                        .put("protocolVersion", 1)
                )
            }
            waitForRawType("RELAY_WELCOME") {
                it.optString("deviceId") == windowsIdentity.deviceId
            }
            runBlocking {
                relayClient.send(
                    JSONObject()
                        .put("type", "TRUSTED_DEVICE_HELLO")
                        .put(
                            "payload",
                            JSONObject()
                                .put(
                                    "deviceIdentity",
                                    JSONObject()
                                        .put("deviceId", windowsIdentity.deviceId)
                                        .put("deviceName", windowsIdentity.deviceName)
                                        .put("platform", windowsIdentity.platform)
                                        .put("publicKey", windowsIdentity.publicKey)
                                )
                                .put("trustedPeerIds", JSONArray().put(androidIdentity.deviceId))
                        )
                )
            }
        }

        fun disconnect() {
            relayClient.disconnect()
        }

        fun sendTextShareAndAwaitAck(text: String): dev.crossbridge.android.network.TextShareAckPayload {
            val created = createTextShareEnvelope(
                fromDeviceId = windowsIdentity.deviceId,
                toDeviceId = androidIdentity.deviceId,
                text = text,
                localPrivateKey = windowsPrivateKey,
                localPublicKey = windowsIdentity.publicKey,
                peerPublicKey = androidPublicKey
            )
            runBlocking {
                relayClient.send(created.envelope.toJson())
            }
            val relayAck = waitForRelayAck(created.envelope.messageId)
            assertTrue(
                "Relay should deliver the background share to Android. Reason=${relayAck.reason}",
                relayAck.delivered
            )
            val decoded = waitForDecodedShare(TEXT_SHARE_ACK_TYPE)
            return (decoded.controlMessage as ShareControlMessage.Ack).payload
        }

        fun awaitNotificationPosted(trigger: () -> Unit): NotificationPostedPayload {
            trigger()
            val decoded = waitForDecodedNotification(NOTIFICATION_POSTED_TYPE)
            return (decoded.controlMessage as NotificationControlMessage.Posted).payload
        }

        fun close() {
            unsubscribeMessages()
            relayClient.close()
        }

        private fun waitForDecodedShare(
            expectedType: String,
            timeoutMs: Long = 15_000L
        ): dev.crossbridge.android.network.DecodedShareEnvelope {
            val message = takeMatching(timeoutMs) { candidate ->
                val decoded = decodeShareEnvelope(
                    message = candidate,
                    localDeviceId = windowsIdentity.deviceId,
                    localPrivateKey = windowsPrivateKey,
                    localPublicKey = windowsIdentity.publicKey,
                    peerPublicKey = androidPublicKey
                ) ?: return@takeMatching false
                when (decoded.controlMessage) {
                    is ShareControlMessage.Ack -> expectedType == TEXT_SHARE_ACK_TYPE
                    else -> false
                }
            }
            return decodeShareEnvelope(
                message = message,
                localDeviceId = windowsIdentity.deviceId,
                localPrivateKey = windowsPrivateKey,
                localPublicKey = windowsIdentity.publicKey,
                peerPublicKey = androidPublicKey
            ) ?: error("Expected a decodable share envelope.")
        }

        private fun waitForDecodedNotification(
            expectedType: String,
            timeoutMs: Long = 15_000L
        ): dev.crossbridge.android.network.DecodedNotificationEnvelope {
            val message = takeMatching(timeoutMs) { candidate ->
                val decoded = decodeNotificationEnvelope(
                    message = candidate,
                    localDeviceId = windowsIdentity.deviceId,
                    localPrivateKey = windowsPrivateKey,
                    localPublicKey = windowsIdentity.publicKey,
                    peerPublicKey = androidPublicKey
                ) ?: return@takeMatching false
                when (decoded.controlMessage) {
                    is NotificationControlMessage.Posted -> expectedType == NOTIFICATION_POSTED_TYPE
                    else -> false
                }
            }
            return decodeNotificationEnvelope(
                message = message,
                localDeviceId = windowsIdentity.deviceId,
                localPrivateKey = windowsPrivateKey,
                localPublicKey = windowsIdentity.publicKey,
                peerPublicKey = androidPublicKey
            ) ?: error("Expected a decodable notification envelope.")
        }

        private fun waitForRawType(
            type: String,
            timeoutMs: Long = 15_000L,
            predicate: (JSONObject) -> Boolean = { true }
        ): JSONObject {
            return takeMatching(timeoutMs) { candidate ->
                candidate.optString("type") == type && predicate(candidate)
            }
        }

        private fun waitForRelayAck(
            messageId: String,
            timeoutMs: Long = 15_000L
        ): dev.crossbridge.android.network.RelayAck {
            val message = takeMatching(timeoutMs) { candidate ->
                val ack = parseRelayAck(candidate) ?: return@takeMatching false
                ack.messageId == messageId
            }
            return parseRelayAck(message) ?: error("Expected a relay acknowledgement.")
        }

        private fun takeMatching(
            timeoutMs: Long,
            matcher: (JSONObject) -> Boolean
        ): JSONObject {
            val deadline = System.currentTimeMillis() + timeoutMs
            while (System.currentTimeMillis() < deadline) {
                synchronized(backlog) {
                    val index = backlog.indexOfFirst(matcher)
                    if (index >= 0) {
                        return backlog.removeAt(index)
                    }
                }

                val remainingMs = (deadline - System.currentTimeMillis()).coerceAtLeast(1L)
                val next = inbox.poll(remainingMs.coerceAtMost(250L), TimeUnit.MILLISECONDS) ?: continue
                synchronized(backlog) {
                    backlog.add(next)
                }
            }
            throw AssertionError("Timed out waiting for fake Windows peer message.")
        }
    }

    companion object {
        private const val RELAY_URL = "ws://10.0.2.2:8787/connect"
        private const val HELPER_PACKAGE = "dev.crossbridge.replyhelper"
        private const val SEEDED_TIMESTAMP = 1_779_850_000_000L
    }
}
