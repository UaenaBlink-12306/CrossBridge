package dev.crossbridge.android

import dev.crossbridge.android.protocol.PairingCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingCodeTest {
    @Test
    fun kotlinHelperMatchesTypescriptFixture() {
        val code = PairingCode.derive(
            pcPublicKey = PairingCode.FIXTURE_PC_PUBLIC_KEY,
            androidPublicKey = PairingCode.FIXTURE_ANDROID_PUBLIC_KEY,
            pairingSessionId = PairingCode.FIXTURE_PAIRING_SESSION_ID
        )

        assertEquals(PairingCode.FIXTURE_EXPECTED_CODE, code)
    }

    @Test
    fun outputMatchesExactlySixDigits() {
        val code = PairingCode.derive(
            pcPublicKey = PairingCode.FIXTURE_PC_PUBLIC_KEY,
            androidPublicKey = PairingCode.FIXTURE_ANDROID_PUBLIC_KEY,
            pairingSessionId = PairingCode.FIXTURE_PAIRING_SESSION_ID
        )

        assertTrue(code.matches(Regex("^\\d{6}$")))
    }

    @Test
    fun helperMatchesTypescriptForSlashBearingBase64Keys() {
        val code = PairingCode.derive(
            pcPublicKey = "pc/key+with=chars",
            androidPublicKey = "android/key+with=chars",
            pairingSessionId = "pair_runtime_session"
        )

        assertEquals("246483", code)
    }

    @Test
    fun differentAndroidKeyProducesDifferentCode() {
        val first = PairingCode.derive(
            pcPublicKey = PairingCode.FIXTURE_PC_PUBLIC_KEY,
            androidPublicKey = PairingCode.FIXTURE_ANDROID_PUBLIC_KEY,
            pairingSessionId = PairingCode.FIXTURE_PAIRING_SESSION_ID
        )
        val second = PairingCode.derive(
            pcPublicKey = PairingCode.FIXTURE_PC_PUBLIC_KEY,
            androidPublicKey = "android_test_public_key_2",
            pairingSessionId = PairingCode.FIXTURE_PAIRING_SESSION_ID
        )

        assertNotEquals(first, second)
    }
}
