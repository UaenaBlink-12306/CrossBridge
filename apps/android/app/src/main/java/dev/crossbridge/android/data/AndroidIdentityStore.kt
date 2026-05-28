package dev.crossbridge.android.data

import android.content.Context
import android.os.Build
import dev.crossbridge.android.crypto.AppMessageCrypto
import dev.crossbridge.android.crypto.DevelopmentKeyPair
import dev.crossbridge.android.protocol.DeviceIdentity
import java.util.UUID

data class AndroidCryptoIdentity(
    val identity: DeviceIdentity,
    val privateKey: String
)

class AndroidIdentityStore(
    private val store: KeyValueStore,
    private val privateKeyStore: KeyValueStore = store,
    private val deviceNameProvider: () -> String = ::androidDeviceName,
    private val keyPairProvider: () -> DevelopmentKeyPair = AppMessageCrypto::generateDevelopmentKeyPair,
    private val deviceIdProvider: () -> String = { "android_${UUID.randomUUID()}" }
) {
    constructor(context: Context) : this(
        store = SharedPreferencesKeyValueStore(
            context.applicationContext.getSharedPreferences(
                "crossbridge_android_identity",
                Context.MODE_PRIVATE
            )
        ),
        privateKeyStore = FallbackKeyValueStore(
            protectedStore = AndroidKeystoreKeyValueStore(
                context.applicationContext.getSharedPreferences(
                    "crossbridge_android_identity_secrets",
                    Context.MODE_PRIVATE
                )
            ),
            fallbackStore = SharedPreferencesKeyValueStore(
                context.applicationContext.getSharedPreferences(
                    "crossbridge_android_identity",
                    Context.MODE_PRIVATE
                )
            )
        )
    )

    fun loadOrCreateIdentity(): DeviceIdentity {
        val stored = loadStoredCryptoIdentity()
        if (stored != null) return stored.identity

        val created = createCryptoIdentity()
        saveCryptoIdentity(created)
        return created.identity
    }

    fun loadOrCreateCryptoIdentity(): AndroidCryptoIdentity {
        val stored = loadStoredCryptoIdentity()
        if (stored != null) return stored

        val created = createCryptoIdentity()
        saveCryptoIdentity(created)
        return created
    }

    private fun createCryptoIdentity(): AndroidCryptoIdentity {
        val keyPair = keyPairProvider()
        return AndroidCryptoIdentity(
            identity = DeviceIdentity(
            deviceId = deviceIdProvider(),
            deviceName = deviceNameProvider(),
            platform = "android",
                publicKey = keyPair.publicKey
            ),
            privateKey = keyPair.privateKey
        )
    }

    private fun saveCryptoIdentity(created: AndroidCryptoIdentity) {
        store.putString(KEY_DEVICE_ID, created.identity.deviceId)
        store.putString(KEY_DEVICE_NAME, created.identity.deviceName)
        store.putString(KEY_PLATFORM, created.identity.platform)
        store.putString(KEY_PUBLIC_KEY, created.identity.publicKey)
        privateKeyStore.putString(KEY_PRIVATE_KEY, created.privateKey)
    }

    fun resetIdentityForDevOnly() {
        store.remove(KEY_DEVICE_ID)
        store.remove(KEY_DEVICE_NAME)
        store.remove(KEY_PLATFORM)
        store.remove(KEY_PUBLIC_KEY)
        privateKeyStore.remove(KEY_PRIVATE_KEY)
    }

    private fun loadStoredCryptoIdentity(): AndroidCryptoIdentity? {
        val deviceId = store.getString(KEY_DEVICE_ID)?.takeIf { it.isNotBlank() }
            ?: return null
        val deviceName = store.getString(KEY_DEVICE_NAME)?.takeIf { it.isNotBlank() }
            ?: deviceNameProvider()
        val publicKey = store.getString(KEY_PUBLIC_KEY)?.takeIf { it.isNotBlank() }
            ?: return null
        val privateKey = privateKeyStore.getString(KEY_PRIVATE_KEY)?.takeIf { it.isNotBlank() }
            ?: return null
        if (!AppMessageCrypto.isValidDevelopmentKeyPair(DevelopmentKeyPair(publicKey, privateKey))) {
            return null
        }
        privateKeyStore.putString(KEY_PRIVATE_KEY, privateKey)

        return AndroidCryptoIdentity(
            identity = DeviceIdentity(
                deviceId = deviceId,
                deviceName = deviceName,
                platform = "android",
                publicKey = publicKey
            ),
            privateKey = privateKey
        )
    }

    private companion object {
        const val KEY_DEVICE_ID = "deviceId"
        const val KEY_DEVICE_NAME = "deviceName"
        const val KEY_PLATFORM = "platform"
        const val KEY_PUBLIC_KEY = "publicKey"
        const val KEY_PRIVATE_KEY = "privateKey"
    }
}

private fun androidDeviceName(): String {
        val manufacturer = Build.MANUFACTURER.orEmpty().trim()
        val model = Build.MODEL.orEmpty().trim()
        val combined = when {
            manufacturer.isBlank() && model.isBlank() -> "CrossBridge Android"
            manufacturer.isBlank() -> model
            model.isBlank() -> manufacturer
            model.startsWith(manufacturer, ignoreCase = true) -> model
            else -> "$manufacturer $model"
        }
        return combined.take(128)
}
