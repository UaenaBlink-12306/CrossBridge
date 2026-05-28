package dev.crossbridge.android.data

import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

interface KeyValueStore {
    fun getString(key: String): String?
    fun putString(key: String, value: String)
    fun remove(key: String)
}

class SharedPreferencesKeyValueStore(
    private val preferences: SharedPreferences
) : KeyValueStore {
    override fun getString(key: String): String? {
        return preferences.getString(key, null)
    }

    override fun putString(key: String, value: String) {
        preferences.edit().putString(key, value).apply()
    }

    override fun remove(key: String) {
        preferences.edit().remove(key).apply()
    }
}

class AndroidKeystoreKeyValueStore(
    private val preferences: SharedPreferences,
    private val keyAlias: String = "crossbridge_android_private_key_wrapper"
) : KeyValueStore {
    override fun getString(key: String): String? {
        val raw = preferences.getString(key, null) ?: return null
        return decrypt(raw)
    }

    override fun putString(key: String, value: String) {
        preferences.edit().putString(key, encrypt(value)).apply()
    }

    override fun remove(key: String) {
        preferences.edit().remove(key).apply()
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey())
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))
        return JSONObject()
            .put("version", 1)
            .put("iv", Base64.getEncoder().encodeToString(iv))
            .put("ciphertext", Base64.getEncoder().encodeToString(ciphertext))
            .toString()
    }

    private fun decrypt(raw: String): String? {
        return try {
            val json = JSONObject(raw)
            if (json.optInt("version") != 1) return null
            val iv = Base64.getDecoder().decode(json.getString("iv"))
            val ciphertext = Base64.getDecoder().decode(json.getString("ciphertext"))
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateSecretKey(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8)
        } catch (_: Exception) {
            null
        }
    }

    private fun getOrCreateSecretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore")
        keyStore.load(null)
        (keyStore.getKey(keyAlias, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        )
        generator.init(
            KeyGenParameterSpec.Builder(
                keyAlias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(false)
                .build()
        )
        return generator.generateKey()
    }
}

class FallbackKeyValueStore(
    private val protectedStore: KeyValueStore,
    private val fallbackStore: KeyValueStore
) : KeyValueStore {
    override fun getString(key: String): String? {
        return try {
            protectedStore.getString(key)
        } catch (_: Exception) {
            null
        } ?: fallbackStore.getString(key)
    }

    override fun putString(key: String, value: String) {
        try {
            protectedStore.putString(key, value)
            fallbackStore.remove(key)
        } catch (_: Exception) {
            fallbackStore.putString(key, value)
        }
    }

    override fun remove(key: String) {
        try {
            protectedStore.remove(key)
        } catch (_: Exception) {
            // The fallback removal still runs so dev/test storage can reset cleanly.
        }
        fallbackStore.remove(key)
    }
}
