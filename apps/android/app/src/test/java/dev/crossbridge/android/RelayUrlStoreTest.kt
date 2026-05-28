package dev.crossbridge.android

import dev.crossbridge.android.data.InMemoryKeyValueStore
import dev.crossbridge.android.data.RelayUrlStore
import org.junit.Assert.assertEquals
import org.junit.Test

class RelayUrlStoreTest {
    @Test
    fun defaultsToAndroidEmulatorRelayUrl() {
        val store = RelayUrlStore(InMemoryKeyValueStore())

        assertEquals("ws://10.0.2.2:8787/connect", store.loadRelayUrl())
    }

    @Test
    fun savesValidWebSocketRelayUrl() {
        val store = RelayUrlStore(InMemoryKeyValueStore())

        store.saveRelayUrl("ws://192.168.1.10:8787/connect")

        assertEquals("ws://192.168.1.10:8787/connect", store.loadRelayUrl())
    }

    @Test
    fun ignoresInvalidRelayUrl() {
        val store = RelayUrlStore(InMemoryKeyValueStore())

        store.saveRelayUrl("https://example.com/connect")

        assertEquals("ws://10.0.2.2:8787/connect", store.loadRelayUrl())
    }
}
