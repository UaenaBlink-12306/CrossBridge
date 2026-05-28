package dev.crossbridge.android

import android.content.Context
import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.crossbridge.android.crypto.AppMessageCrypto
import dev.crossbridge.android.crypto.DevelopmentKeyPair
import dev.crossbridge.android.network.ConnectionManager
import dev.crossbridge.android.network.RelayClient
import dev.crossbridge.android.network.ShareControlMessage
import dev.crossbridge.android.network.createLanDiscoveryProbeEnvelope
import dev.crossbridge.android.network.decodeShareEnvelope
import dev.crossbridge.android.protocol.DeviceIdentity
import dev.crossbridge.android.protocol.TrustedDevice
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
class LanDiscoveryProbingRuntimeTest {
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
        app.connectionManager.refreshAfterPairingComplete()
        launchApp()
        
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
    }

    @Test
    fun reachableCandidateTransitionsToLanConnectionMode() {
        // Send LAN discovery probe containing the host IP address 10.0.2.2 and port 8789
        // This is where our mock TCP probe listener will be listening on the host.
        windowsPeer.sendLanDiscoveryProbe(
            candidates = listOf("10.0.2.2"),
            port = 8789
        )

        // Wait and verify that the trusted device connectionMode transitions to "lan"
        waitForConnectionMode(app.connectionManager, windowsIdentity.deviceId, expectedMode = "lan")

        // Assert that the state updated successfully and shows local fast path is active
        val trustedDevice = app.connectionManager.viewState.value.trustedDevices
            .firstOrNull { it.device.deviceId == windowsIdentity.deviceId }
        assertTrue("Trusted device should exist", trustedDevice != null)
        assertEquals("lan", trustedDevice?.connectionMode)
    }

    @Test
    fun unreachableCandidateStaysInRelayFallbackCleanly() {
        // Send LAN discovery probe containing a completely unreachable/isolated IP address
        windowsPeer.sendLanDiscoveryProbe(
            candidates = listOf("192.0.2.1"), // RFC 5737 TEST-NET-1 unreachable address
            port = 8789
        )

        // Wait and verify that the device stays online but connectionMode remains "relay" or null
        // because the probe will timeout/fail and fall back cleanly.
        Thread.sleep(5_000L) // Wait for probing timeout to complete

        val trustedDevice = app.connectionManager.viewState.value.trustedDevices
            .firstOrNull { it.device.deviceId == windowsIdentity.deviceId }
        assertTrue("Trusted device should exist", trustedDevice != null)
        // Connection mode should stay as "relay" or fallback
        assertEquals("relay", trustedDevice?.connectionMode ?: "relay")
        assertTrue("Relay fallback is healthy and online", trustedDevice?.online == true)
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

    private fun waitForTrustedDeviceOnline(
        connectionManager: ConnectionManager,
        deviceId: String,
        timeoutMs: Long = 15_000L
    ) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val match = connectionManager.viewState.value.trustedDevices
                .firstOrNull { it.device.deviceId == deviceId }
            if (match != null && match.online) {
                return
            }
            Thread.sleep(250L)
        }
        throw AssertionError("Timed out waiting for trusted device $deviceId to become online")
    }

    private fun waitForConnectionMode(
        connectionManager: ConnectionManager,
        deviceId: String,
        expectedMode: String,
        timeoutMs: Long = 15_000L
    ) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val match = connectionManager.viewState.value.trustedDevices
                .firstOrNull { it.device.deviceId == deviceId }
            if (match != null && match.connectionMode == expectedMode) {
                return
            }
            Thread.sleep(250L)
        }
        throw AssertionError("Timed out waiting for trusted device $deviceId connectionMode to become $expectedMode")
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
                        .put("sessionToken", "runtime_lan_${windowsIdentity.deviceId}_${System.currentTimeMillis()}")
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

        fun sendLanDiscoveryProbe(candidates: List<String>, port: Int) {
            val ipsArray = JSONArray()
            candidates.forEach { ipsArray.put(it) }

            val envelope = createLanDiscoveryProbeEnvelope(
                fromDeviceId = windowsIdentity.deviceId,
                toDeviceId = androidIdentity.deviceId,
                localIps = candidates,
                port = port,
                isReachable = false,
                localPrivateKey = windowsPrivateKey,
                localPublicKey = windowsIdentity.publicKey,
                peerPublicKey = androidPublicKey
            )

            runBlocking {
                relayClient.send(envelope.toJson())
            }
        }

        fun close() {
            unsubscribeMessages()
            relayClient.close()
        }

        private fun waitForRawType(
            type: String,
            timeoutMs: Long = 15_000L,
            predicate: (JSONObject) -> Boolean = { true }
        ): JSONObject {
            val deadline = System.currentTimeMillis() + timeoutMs
            while (System.currentTimeMillis() < deadline) {
                synchronized(backlog) {
                    val index = backlog.indexOfFirst { it.optString("type") == type && predicate(it) }
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
            throw AssertionError("Timed out waiting for fake Windows peer message of type $type.")
        }
    }

    companion object {
        private const val RELAY_URL = "ws://10.0.2.2:8787/connect"
        private const val SEEDED_TIMESTAMP = 1_779_850_000_000L
    }
}
