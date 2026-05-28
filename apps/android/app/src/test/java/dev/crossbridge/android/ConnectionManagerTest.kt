package dev.crossbridge.android

import dev.crossbridge.android.network.applyTrustedDeviceOffline
import dev.crossbridge.android.network.applyTrustedDeviceOnline
import dev.crossbridge.android.network.applyTrustedDeviceStatus
import dev.crossbridge.android.network.createTrustedDeviceConnections
import dev.crossbridge.android.network.reconnectDelayMs
import dev.crossbridge.android.protocol.DeviceIdentity
import dev.crossbridge.android.protocol.TrustedDevice
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectionManagerTest {
    @Test
    fun trustedDevicesStartOffline() {
        val connections = createTrustedDeviceConnections(listOf(windowsDevice()))

        assertEquals(1, connections.size)
        assertFalse(connections.single().online)
        assertEquals(1_500L, connections.single().lastSeenAt)
    }

    @Test
    fun onlineStatusOnlyUpdatesMatchingTrustedDevice() {
        val connections = createTrustedDeviceConnections(listOf(windowsDevice()))
        val online = applyTrustedDeviceOnline(
            devices = connections,
            deviceIdentity = DeviceIdentity(
                deviceId = "pc_1",
                deviceName = "Windows Laptop",
                platform = "windows",
                publicKey = "pc_public_key"
            ),
            timestamp = 2_000L
        )

        assertTrue(online.single().online)
        assertEquals("relay", online.single().connectionMode)
        assertEquals("Windows Laptop", online.single().device.deviceName)
        assertEquals(2_000L, online.single().lastSeenAt)

        val unchanged = applyTrustedDeviceOnline(
            devices = connections,
            deviceIdentity = DeviceIdentity(
                deviceId = "pc_unknown",
                deviceName = "Unknown",
                platform = "windows",
                publicKey = "unknown_public_key"
            ),
            timestamp = 3_000L
        )
        assertEquals(connections, unchanged)
    }

    @Test
    fun onlineStatusSupportsLanFastPath() {
        val connections = createTrustedDeviceConnections(listOf(windowsDevice()))
        val onlineWithLan = connections.map {
            it.copy(localFastPathAvailable = true)
        }
        val online = applyTrustedDeviceOnline(
            devices = onlineWithLan,
            deviceIdentity = DeviceIdentity(
                deviceId = "pc_1",
                deviceName = "Windows PC",
                platform = "windows",
                publicKey = "pc_public_key"
            ),
            timestamp = 2_000L
        )

        assertTrue(online.single().online)
        assertEquals("lan", online.single().connectionMode)
        assertTrue(online.single().localFastPathAvailable)
    }


    @Test
    fun offlineAndStatusUpdatesRefreshLastSeen() {
        val online = applyTrustedDeviceOnline(
            devices = createTrustedDeviceConnections(listOf(windowsDevice())),
            deviceIdentity = DeviceIdentity(
                deviceId = "pc_1",
                deviceName = "Windows PC",
                platform = "windows",
                publicKey = "pc_public_key"
            ),
            timestamp = 2_000L
        )

        val offline = applyTrustedDeviceOffline(online, "pc_1", 3_000L)
        assertFalse(offline.single().online)
        assertEquals(3_000L, offline.single().lastSeenAt)

        val status = applyTrustedDeviceStatus(offline, "pc_1", online = true, lastSeenAt = 4_000L)
        assertTrue(status.single().online)
        assertEquals("relay", status.single().connectionMode)
        assertEquals(4_000L, status.single().lastSeenAt)
    }

    @Test
    fun reconnectBackoffUsesBoundedDelays() {
        assertEquals(
            listOf(1_000L, 2_000L, 5_000L, 10_000L, 30_000L, 30_000L),
            listOf(1, 2, 3, 4, 5, 12).map(::reconnectDelayMs)
        )
    }

    @Test
    fun connectionViewStateHasEmptyTransfers() {
        val state = dev.crossbridge.android.network.ConnectionViewState()
        assertEquals(emptyList<dev.crossbridge.android.network.FileTransferState>(), state.transfers)
    }

    private fun windowsDevice(): TrustedDevice {
        return TrustedDevice(
            deviceId = "pc_1",
            deviceName = "Windows PC",
            platform = "windows",
            publicKey = "pc_public_key",
            pairedAt = 1_000L,
            lastSeenAt = 1_500L
        )
    }
}
