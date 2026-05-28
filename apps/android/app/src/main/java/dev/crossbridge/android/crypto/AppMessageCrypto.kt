package dev.crossbridge.android.crypto

import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.security.SecureRandom
import java.security.spec.ECGenParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.json.JSONObject

const val APP_MESSAGE_ALGORITHM = "ECDH-P256-HKDF-SHA256-AES-GCM"

data class DevelopmentKeyPair(
    val publicKey: String,
    val privateKey: String
)

data class SecureAppMessage(
    val version: Int = 1,
    val id: String,
    val type: String,
    val timestamp: Long,
    val fromDeviceId: String,
    val toDeviceId: String,
    val payload: JSONObject
) {
    fun toJson(): JSONObject {
        return JSONObject()
            .put("version", version)
            .put("id", id)
            .put("type", type)
            .put("timestamp", timestamp)
            .put("fromDeviceId", fromDeviceId)
            .put("toDeviceId", toDeviceId)
            .put("payload", payload)
    }
}

object AppMessageCrypto {
    private val secureRandom = SecureRandom()

    fun generateDevelopmentKeyPair(): DevelopmentKeyPair {
        val generator = KeyPairGenerator.getInstance("EC")
        generator.initialize(ECGenParameterSpec("secp256r1"), secureRandom)
        val keyPair = generator.generateKeyPair()
        return DevelopmentKeyPair(
            publicKey = Base64.getEncoder().encodeToString(keyPair.public.encoded),
            privateKey = Base64.getEncoder().encodeToString(keyPair.private.encoded)
        )
    }

    fun isValidDevelopmentKeyPair(keyPair: DevelopmentKeyPair): Boolean {
        return try {
            importPublicKey(keyPair.publicKey)
            importPrivateKey(keyPair.privateKey)
            true
        } catch (_: Exception) {
            false
        }
    }

    fun encrypt(
        message: SecureAppMessage,
        localPrivateKey: String,
        localPublicKey: String,
        peerPublicKey: String
    ): JSONObject {
        val nonce = ByteArray(12)
        secureRandom.nextBytes(nonce)
        val nonceBase64 = Base64.getEncoder().encodeToString(nonce)
        val keyId = deriveKeyId(
            localDeviceId = message.fromDeviceId,
            localPublicKey = localPublicKey,
            peerDeviceId = message.toDeviceId,
            peerPublicKey = peerPublicKey
        )
        val metadata = canonicalEnvelopeMetadata(
            version = 1,
            fromDeviceId = message.fromDeviceId,
            toDeviceId = message.toDeviceId,
            messageId = message.id,
            timestamp = message.timestamp,
            nonce = nonceBase64,
            algorithm = APP_MESSAGE_ALGORITHM,
            keyId = keyId
        )
        val key = deriveAesKey(
            localDeviceId = message.fromDeviceId,
            localPrivateKey = localPrivateKey,
            localPublicKey = localPublicKey,
            peerDeviceId = message.toDeviceId,
            peerPublicKey = peerPublicKey
        )
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, nonce))
        cipher.updateAAD(metadata.toByteArray(StandardCharsets.UTF_8))
        val ciphertext = cipher.doFinal(message.toJson().toString().toByteArray(StandardCharsets.UTF_8))

        return JSONObject()
            .put("version", 1)
            .put("fromDeviceId", message.fromDeviceId)
            .put("toDeviceId", message.toDeviceId)
            .put("messageId", message.id)
            .put("timestamp", message.timestamp)
            .put("nonce", nonceBase64)
            .put("ciphertext", Base64.getEncoder().encodeToString(ciphertext))
            .put("algorithm", APP_MESSAGE_ALGORITHM)
            .put("keyId", keyId)
    }

    fun decrypt(
        envelope: JSONObject,
        localDeviceId: String,
        localPrivateKey: String,
        localPublicKey: String,
        peerPublicKey: String
    ): SecureAppMessage {
        val algorithm = envelope.getString("algorithm")
        require(algorithm == APP_MESSAGE_ALGORITHM) { "Unsupported encrypted envelope algorithm." }

        val fromDeviceId = envelope.getString("fromDeviceId")
        val toDeviceId = envelope.getString("toDeviceId")
        val peerDeviceId = if (fromDeviceId == localDeviceId) toDeviceId else fromDeviceId
        val expectedKeyId = deriveKeyId(
            localDeviceId = localDeviceId,
            localPublicKey = localPublicKey,
            peerDeviceId = peerDeviceId,
            peerPublicKey = peerPublicKey
        )
        require(envelope.getString("keyId") == expectedKeyId) {
            "Encrypted envelope key id did not match the trusted peer."
        }

        val key = deriveAesKey(
            localDeviceId = localDeviceId,
            localPrivateKey = localPrivateKey,
            localPublicKey = localPublicKey,
            peerDeviceId = peerDeviceId,
            peerPublicKey = peerPublicKey
        )
        val nonce = Base64.getDecoder().decode(envelope.getString("nonce"))
        val metadata = canonicalEnvelopeMetadata(
            version = envelope.getInt("version"),
            fromDeviceId = fromDeviceId,
            toDeviceId = toDeviceId,
            messageId = envelope.getString("messageId"),
            timestamp = envelope.getLong("timestamp"),
            nonce = envelope.getString("nonce"),
            algorithm = algorithm,
            keyId = envelope.getString("keyId")
        )
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, nonce))
        cipher.updateAAD(metadata.toByteArray(StandardCharsets.UTF_8))
        val plaintext = cipher.doFinal(Base64.getDecoder().decode(envelope.getString("ciphertext")))
        val message = JSONObject(String(plaintext, StandardCharsets.UTF_8)).toSecureAppMessage()
        require(message.id == envelope.getString("messageId"))
        require(message.fromDeviceId == fromDeviceId)
        require(message.toDeviceId == toDeviceId)
        return message
    }

    private fun deriveAesKey(
        localDeviceId: String,
        localPrivateKey: String,
        localPublicKey: String,
        peerDeviceId: String,
        peerPublicKey: String
    ): SecretKeySpec {
        val agreement = KeyAgreement.getInstance("ECDH")
        agreement.init(importPrivateKey(localPrivateKey))
        agreement.doPhase(importPublicKey(peerPublicKey), true)
        val sharedSecret = agreement.generateSecret()
        val salt = sha256(
            canonicalKeyParticipants(
                localDeviceId = localDeviceId,
                localPublicKey = localPublicKey,
                peerDeviceId = peerDeviceId,
                peerPublicKey = peerPublicKey
            ).toByteArray(StandardCharsets.UTF_8)
        )
        val keyBytes = hkdfSha256(
            ikm = sharedSecret,
            salt = salt,
            info = "CrossBridge app-message AES-GCM key v1".toByteArray(StandardCharsets.UTF_8),
            length = 32
        )
        return SecretKeySpec(keyBytes, "AES")
    }

    private fun deriveKeyId(
        localDeviceId: String,
        localPublicKey: String,
        peerDeviceId: String,
        peerPublicKey: String
    ): String {
        val digest = sha256(
            canonicalKeyParticipants(
                localDeviceId = localDeviceId,
                localPublicKey = localPublicKey,
                peerDeviceId = peerDeviceId,
                peerPublicKey = peerPublicKey
            ).toByteArray(StandardCharsets.UTF_8)
        )
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest).take(32)
    }

    private fun importPublicKey(publicKey: String): PublicKey {
        return KeyFactory.getInstance("EC")
            .generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(publicKey)))
    }

    private fun importPrivateKey(privateKey: String): PrivateKey {
        return KeyFactory.getInstance("EC")
            .generatePrivate(PKCS8EncodedKeySpec(Base64.getDecoder().decode(privateKey)))
    }

    private fun canonicalKeyParticipants(
        localDeviceId: String,
        localPublicKey: String,
        peerDeviceId: String,
        peerPublicKey: String
    ): String {
        val firstIsLocal = localDeviceId <= peerDeviceId
        val firstDeviceId = if (firstIsLocal) localDeviceId else peerDeviceId
        val firstPublicKey = if (firstIsLocal) localPublicKey else peerPublicKey
        val secondDeviceId = if (firstIsLocal) peerDeviceId else localDeviceId
        val secondPublicKey = if (firstIsLocal) peerPublicKey else localPublicKey
        val json = JSONObject()
            .put("version", 1)
            .put(
                "participants",
                org.json.JSONArray()
                    .put(JSONObject().put("deviceId", firstDeviceId).put("publicKey", firstPublicKey))
                    .put(JSONObject().put("deviceId", secondDeviceId).put("publicKey", secondPublicKey))
            )
            .toString()
            .replace("\\/", "/")
        return json
    }

    private fun canonicalEnvelopeMetadata(
        version: Int,
        fromDeviceId: String,
        toDeviceId: String,
        messageId: String,
        timestamp: Long,
        nonce: String,
        algorithm: String,
        keyId: String
    ): String {
        return JSONObject()
            .put("version", version)
            .put("fromDeviceId", fromDeviceId)
            .put("toDeviceId", toDeviceId)
            .put("messageId", messageId)
            .put("timestamp", timestamp)
            .put("nonce", nonce)
            .put("algorithm", algorithm)
            .put("keyId", keyId)
            .toString()
            .replace("\\/", "/")
    }

    private fun JSONObject.toSecureAppMessage(): SecureAppMessage {
        return SecureAppMessage(
            version = getInt("version"),
            id = getString("id"),
            type = getString("type"),
            timestamp = getLong("timestamp"),
            fromDeviceId = getString("fromDeviceId"),
            toDeviceId = getString("toDeviceId"),
            payload = getJSONObject("payload")
        )
    }

    private fun sha256(input: ByteArray): ByteArray {
        return MessageDigest.getInstance("SHA-256").digest(input)
    }

    private fun hkdfSha256(
        ikm: ByteArray,
        salt: ByteArray,
        info: ByteArray,
        length: Int
    ): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(salt, "HmacSHA256"))
        val prk = mac.doFinal(ikm)
        val output = ByteArray(length)
        var previous = ByteArray(0)
        var offset = 0
        var counter = 1

        while (offset < length) {
            mac.init(SecretKeySpec(prk, "HmacSHA256"))
            mac.update(previous)
            mac.update(info)
            mac.update(counter.toByte())
            previous = mac.doFinal()
            val copyLength = minOf(previous.size, length - offset)
            System.arraycopy(previous, 0, output, offset, copyLength)
            offset += copyLength
            counter += 1
        }
        return output
    }
}
