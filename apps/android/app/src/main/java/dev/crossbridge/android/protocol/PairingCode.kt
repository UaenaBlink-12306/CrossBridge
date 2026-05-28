package dev.crossbridge.android.protocol

import java.security.MessageDigest

object PairingCode {
    const val FIXTURE_PC_PUBLIC_KEY = "pc_test_public_key"
    const val FIXTURE_ANDROID_PUBLIC_KEY = "android_test_public_key"
    const val FIXTURE_PAIRING_SESSION_ID = "pairing_test_session"
    const val FIXTURE_EXPECTED_CODE = "926486"

    fun derive(
        pcPublicKey: String,
        androidPublicKey: String,
        pairingSessionId: String
    ): String {
        val canonicalInput = buildString {
            append("{\"version\":1")
            append(",\"pcPublicKey\":")
            append(jsonStringify(pcPublicKey))
            append(",\"androidPublicKey\":")
            append(jsonStringify(androidPublicKey))
            append(",\"pairingSessionId\":")
            append(jsonStringify(pairingSessionId))
            append("}")
        }
        val hash = MessageDigest.getInstance("SHA-256")
            .digest(canonicalInput.toByteArray(Charsets.UTF_8))
        val firstUInt32 = ((hash[0].toLong() and 0xff) shl 24) or
            ((hash[1].toLong() and 0xff) shl 16) or
            ((hash[2].toLong() and 0xff) shl 8) or
            (hash[3].toLong() and 0xff)
        return (firstUInt32 % 1_000_000L).toString().padStart(6, '0')
    }

    private fun jsonStringify(value: String): String {
        return buildString {
            append('"')
            value.forEach { char ->
                when (char) {
                    '"' -> append("\\\"")
                    '\\' -> append("\\\\")
                    '\b' -> append("\\b")
                    '\u000C' -> append("\\f")
                    '\n' -> append("\\n")
                    '\r' -> append("\\r")
                    '\t' -> append("\\t")
                    else -> {
                        if (char.code < 0x20) {
                            append("\\u")
                            append(char.code.toString(16).padStart(4, '0'))
                        } else {
                            append(char)
                        }
                    }
                }
            }
            append('"')
        }
    }
}
