package dev.crossbridge.android

import dev.crossbridge.android.crypto.AppMessageCrypto
import dev.crossbridge.android.data.AndroidIdentityStore
import dev.crossbridge.android.data.FallbackKeyValueStore
import dev.crossbridge.android.data.InMemoryKeyValueStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidIdentityStoreTest {
    @Test
    fun identityIsCreated() {
        val store = identityStore()

        val identity = store.loadOrCreateIdentity()

        assertTrue(identity.deviceId.startsWith("android_"))
        assertEquals("Test Android", identity.deviceName)
        assertEquals("android", identity.platform)
        assertTrue(identity.publicKey.isNotBlank())
    }

    @Test
    fun identityIsStableAcrossRepeatedLoads() {
        val store = identityStore()

        val first = store.loadOrCreateIdentity()
        val second = store.loadOrCreateIdentity()

        assertEquals(first, second)
    }

    @Test
    fun resetIdentityCreatesNewIdentity() {
        val store = identityStore()
        val first = store.loadOrCreateIdentity()

        store.resetIdentityForDevOnly()
        val second = store.loadOrCreateIdentity()

        assertNotEquals(first.deviceId, second.deviceId)
        assertNotEquals(first.publicKey, second.publicKey)
    }

    @Test
    fun identityUsesAndroidPlatformAndPrefix() {
        val identity = identityStore().loadOrCreateIdentity()

        assertEquals("android", identity.platform)
        assertTrue(identity.deviceId.startsWith("android_"))
    }

    @Test
    fun privateKeyUsesSeparateStoreWhenProvided() {
        val publicStore = InMemoryKeyValueStore()
        val privateStore = InMemoryKeyValueStore()
        val store = AndroidIdentityStore(
            store = publicStore,
            privateKeyStore = privateStore,
            deviceNameProvider = { "Test Android" },
            keyPairProvider = AppMessageCrypto::generateDevelopmentKeyPair,
            deviceIdProvider = { "android_1" }
        )

        val cryptoIdentity = store.loadOrCreateCryptoIdentity()

        assertEquals(null, publicStore.getString("privateKey"))
        assertEquals(cryptoIdentity.privateKey, privateStore.getString("privateKey"))
    }

    @Test
    fun legacyPrivateKeyMigratesToProtectedStore() {
        val publicStore = InMemoryKeyValueStore()
        val protectedStore = InMemoryKeyValueStore()
        val keyPair = AppMessageCrypto.generateDevelopmentKeyPair()
        publicStore.putString("deviceId", "android_1")
        publicStore.putString("deviceName", "Test Android")
        publicStore.putString("platform", "android")
        publicStore.putString("publicKey", keyPair.publicKey)
        publicStore.putString("privateKey", keyPair.privateKey)
        val store = AndroidIdentityStore(
            store = publicStore,
            privateKeyStore = FallbackKeyValueStore(
                protectedStore = protectedStore,
                fallbackStore = publicStore
            ),
            deviceNameProvider = { "Test Android" },
            keyPairProvider = AppMessageCrypto::generateDevelopmentKeyPair,
            deviceIdProvider = { "android_new" }
        )

        val cryptoIdentity = store.loadOrCreateCryptoIdentity()

        assertEquals("android_1", cryptoIdentity.identity.deviceId)
        assertEquals(keyPair.privateKey, protectedStore.getString("privateKey"))
        assertEquals(null, publicStore.getString("privateKey"))
    }

    private fun identityStore(): AndroidIdentityStore {
        var idCounter = 0
        return AndroidIdentityStore(
            store = InMemoryKeyValueStore(),
            deviceNameProvider = { "Test Android" },
            keyPairProvider = AppMessageCrypto::generateDevelopmentKeyPair,
            deviceIdProvider = {
                idCounter += 1
                "android_$idCounter"
            }
        )
    }
}
