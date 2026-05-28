package dev.crossbridge.android

import dev.crossbridge.android.data.InMemoryKeyValueStore
import dev.crossbridge.android.data.TrustedDeviceStore
import dev.crossbridge.android.protocol.TrustedDevice
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TrustedDeviceStoreTest {
    @Test
    fun saveAndLoadDevice() {
        val store = TrustedDeviceStore(InMemoryKeyValueStore())
        val device = trustedDevice(deviceId = "pc_1")

        store.saveTrustedDevice(device)

        assertEquals(listOf(device), store.loadTrustedDevices())
    }

    @Test
    fun deduplicatesByDeviceId() {
        val store = TrustedDeviceStore(InMemoryKeyValueStore())
        store.saveTrustedDevice(trustedDevice(deviceId = "pc_1", deviceName = "Old PC"))
        store.saveTrustedDevice(
            trustedDevice(
                deviceId = "pc_1",
                deviceName = "Updated PC",
                pairedAt = 200,
                lastSeenAt = 300
            )
        )

        val devices = store.loadTrustedDevices()

        assertEquals(1, devices.size)
        assertEquals("Updated PC", devices.single().deviceName)
        assertEquals(300L, devices.single().lastSeenAt)
    }

    @Test
    fun updatingExistingDeviceChangesLastSeenAt() {
        var nowMs = 500L
        val store = TrustedDeviceStore(InMemoryKeyValueStore()) { nowMs }
        store.saveTrustedDevice(trustedDevice(deviceId = "pc_1", lastSeenAt = null))

        nowMs = 900L
        store.saveTrustedDevice(trustedDevice(deviceId = "pc_1", lastSeenAt = null))

        assertEquals(900L, store.loadTrustedDevices().single().lastSeenAt)
    }

    @Test
    fun removeDevice() {
        val store = TrustedDeviceStore(InMemoryKeyValueStore())
        store.saveTrustedDevice(trustedDevice(deviceId = "pc_1"))
        store.saveTrustedDevice(trustedDevice(deviceId = "pc_2", pairedAt = 200))

        store.removeTrustedDevice("pc_1")

        val devices = store.loadTrustedDevices()
        assertEquals(1, devices.size)
        assertEquals("pc_2", devices.single().deviceId)
    }

    @Test
    fun malformedStoredJsonIsIgnoredSafely() {
        val keyValueStore = InMemoryKeyValueStore()
        keyValueStore.putString("trustedDevices", "{not valid json")
        val store = TrustedDeviceStore(keyValueStore)

        assertTrue(store.loadTrustedDevices().isEmpty())
    }

    private fun trustedDevice(
        deviceId: String,
        deviceName: String = "Windows PC",
        pairedAt: Long = 100,
        lastSeenAt: Long? = null
    ): TrustedDevice {
        return TrustedDevice(
            deviceId = deviceId,
            deviceName = deviceName,
            platform = "windows",
            publicKey = "pc_public_key",
            pairedAt = pairedAt,
            lastSeenAt = lastSeenAt
        )
    }
}
