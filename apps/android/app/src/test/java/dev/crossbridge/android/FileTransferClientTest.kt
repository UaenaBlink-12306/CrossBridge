package dev.crossbridge.android

import dev.crossbridge.android.crypto.AppMessageCrypto
import dev.crossbridge.android.network.FileTransferControlMessage
import dev.crossbridge.android.network.createFileAcceptEnvelope
import dev.crossbridge.android.network.createFileCancelEnvelope
import dev.crossbridge.android.network.createFileChunkEnvelope
import dev.crossbridge.android.network.createFileCompleteEnvelope
import dev.crossbridge.android.network.createFileOfferEnvelope
import dev.crossbridge.android.network.createFileProgressEnvelope
import dev.crossbridge.android.network.createFileRejectEnvelope
import dev.crossbridge.android.network.decodeFileTransferEnvelope
import dev.crossbridge.android.network.reassembleTransferredFile
import dev.crossbridge.android.network.splitIntoFileChunks
import dev.crossbridge.android.network.summarizeRiskyFileWarning
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

class FileTransferClientTest {
    @Test
    fun createsChunksAndDecodesEncryptedFileOffers() {
        val pc = AppMessageCrypto.generateDevelopmentKeyPair()
        val android = AppMessageCrypto.generateDevelopmentKeyPair()
        val bytes = "CrossBridge file transfer payload".toByteArray()
        val created = createFileOfferEnvelope(
            fromDeviceId = "pc_1",
            toDeviceId = "android_1",
            fileName = "notes.txt",
            mimeType = "text/plain",
            bytes = bytes,
            direction = "WINDOWS_TO_ANDROID",
            chunkSize = 8,
            localPrivateKey = pc.privateKey,
            localPublicKey = pc.publicKey,
            peerPublicKey = android.publicKey,
            now = 2_000L
        )

        assertEquals(bytes.size.toLong(), created.payload.fileSize)
        assertTrue(created.chunks.size > 1)
        assertTrue(!created.envelope.ciphertext.contains("CrossBridge"))

        val decoded = decodeFileTransferEnvelope(
            message = created.envelope.toJson(),
            localDeviceId = "android_1",
            localPrivateKey = android.privateKey,
            localPublicKey = android.publicKey,
            peerPublicKey = pc.publicKey
        )
        assertTrue(decoded?.controlMessage is FileTransferControlMessage.Offer)
        assertArrayEquals(
            bytes,
            reassembleTransferredFile(created.chunks.map { it.payload }, created.payload.sha256)
        )
    }

    @Test
    fun createsAndDecodesTransferStatusMessages() {
        val pc = AppMessageCrypto.generateDevelopmentKeyPair()
        val android = AppMessageCrypto.generateDevelopmentKeyPair()
        val progress = createFileProgressEnvelope(
            fromDeviceId = "android_1",
            toDeviceId = "pc_1",
            transferId = "transfer_1",
            bytesTransferred = 128,
            totalBytes = 512,
            localPrivateKey = android.privateKey,
            localPublicKey = android.publicKey,
            peerPublicKey = pc.publicKey,
            now = 3_000L
        )
        val complete = createFileCompleteEnvelope(
            fromDeviceId = "android_1",
            toDeviceId = "pc_1",
            transferId = "transfer_1",
            sha256 = "a".repeat(64),
            localPrivateKey = android.privateKey,
            localPublicKey = android.publicKey,
            peerPublicKey = pc.publicKey,
            now = 3_000L
        )
        val cancel = createFileCancelEnvelope("android_1", "pc_1", "transfer_1", android.privateKey, android.publicKey, pc.publicKey)
        val reject = createFileRejectEnvelope("android_1", "pc_1", "transfer_1", "Declined", android.privateKey, android.publicKey, pc.publicKey)
        val accept = createFileAcceptEnvelope("android_1", "pc_1", "transfer_1", true, android.privateKey, android.publicKey, pc.publicKey)

        assertTrue(decodeForPc(progress, pc, android)?.controlMessage is FileTransferControlMessage.Progress)
        assertTrue(decodeForPc(complete, pc, android)?.controlMessage is FileTransferControlMessage.Complete)
        assertTrue(decodeForPc(cancel, pc, android)?.controlMessage is FileTransferControlMessage.Cancel)
        assertTrue(decodeForPc(reject, pc, android)?.controlMessage is FileTransferControlMessage.Reject)
        assertTrue(decodeForPc(accept, pc, android)?.controlMessage is FileTransferControlMessage.Accept)
    }

    @Test
    fun verifiesChunkHashesDuringReassembly() {
        val bytes = "hello world".toByteArray()
        val chunk = splitIntoFileChunks("transfer_1", bytes, 64).single().payload
        val tampered = chunk.copy(data = Base64.getEncoder().encodeToString("jello world".toByteArray()))

        var thrown = false
        try {
            reassembleTransferredFile(listOf(tampered))
        } catch (_: IllegalArgumentException) {
            thrown = true
        }
        assertTrue(thrown)
    }

    @Test
    fun flagsRiskyFileWarnings() {
        assertNotNull(summarizeRiskyFileWarning("setup.exe"))
        assertNull(summarizeRiskyFileWarning("photo.png"))
    }

    @Test
    fun createsEncryptedChunkEnvelopes() {
        val pc = AppMessageCrypto.generateDevelopmentKeyPair()
        val android = AppMessageCrypto.generateDevelopmentKeyPair()
        val chunk = splitIntoFileChunks("transfer_2", "chunk me".toByteArray(), 4).first()
        val envelope = createFileChunkEnvelope(
            fromDeviceId = "pc_1",
            toDeviceId = "android_1",
            payload = chunk.payload,
            localPrivateKey = pc.privateKey,
            localPublicKey = pc.publicKey,
            peerPublicKey = android.publicKey,
            now = 4_000L
        )
        val decoded = decodeFileTransferEnvelope(
            message = envelope.toJson(),
            localDeviceId = "android_1",
            localPrivateKey = android.privateKey,
            localPublicKey = android.publicKey,
            peerPublicKey = pc.publicKey
        )
        assertTrue(decoded?.controlMessage is FileTransferControlMessage.Chunk)
    }

    private fun decodeForPc(
        envelope: dev.crossbridge.android.network.RelayEnvelope,
        pc: dev.crossbridge.android.crypto.DevelopmentKeyPair,
        android: dev.crossbridge.android.crypto.DevelopmentKeyPair
    ) = decodeFileTransferEnvelope(
        message = envelope.toJson(),
        localDeviceId = "pc_1",
        localPrivateKey = pc.privateKey,
        localPublicKey = pc.publicKey,
        peerPublicKey = android.publicKey
    )
}
