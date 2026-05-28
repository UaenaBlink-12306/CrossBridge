package dev.crossbridge.android.network

import dev.crossbridge.android.crypto.AppMessageCrypto
import dev.crossbridge.android.crypto.SecureAppMessage
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import org.json.JSONException
import org.json.JSONObject

const val DEFAULT_FILE_CHUNK_BYTES = 64 * 1024
const val FILE_OFFER_TYPE = "FILE_OFFER"
const val FILE_ACCEPT_TYPE = "FILE_ACCEPT"
const val FILE_REJECT_TYPE = "FILE_REJECT"
const val FILE_CHUNK_TYPE = "FILE_CHUNK"
const val FILE_PROGRESS_TYPE = "FILE_PROGRESS"
const val FILE_COMPLETE_TYPE = "FILE_COMPLETE"
const val FILE_CANCEL_TYPE = "FILE_CANCEL"

data class FileOfferPayload(
    val transferId: String,
    val fromDeviceId: String,
    val toDeviceId: String,
    val fileName: String,
    val fileSize: Long,
    val mimeType: String,
    val sha256: String,
    val direction: String,
    val createdAt: Long
)

data class FileAcceptPayload(
    val transferId: String,
    val fromDeviceId: String,
    val toDeviceId: String,
    val accepted: Boolean,
    val acceptedAt: Long
)

data class FileRejectPayload(
    val transferId: String,
    val fromDeviceId: String,
    val toDeviceId: String,
    val reason: String
)

data class FileChunkPayload(
    val transferId: String,
    val fromDeviceId: String,
    val toDeviceId: String,
    val chunkIndex: Int,
    val totalChunks: Int,
    val byteLength: Int,
    val chunkHash: String,
    val data: String
)

data class FileProgressPayload(
    val transferId: String,
    val fromDeviceId: String,
    val toDeviceId: String,
    val bytesTransferred: Long,
    val totalBytes: Long
)

data class FileCompletePayload(
    val transferId: String,
    val fromDeviceId: String,
    val toDeviceId: String,
    val sha256: String,
    val completedAt: Long
)

data class FileCancelPayload(
    val transferId: String,
    val fromDeviceId: String,
    val toDeviceId: String,
    val reason: String? = null
)

data class FileChunkDescriptor(
    val bytes: ByteArray,
    val payload: FileChunkPayload
)

data class CreatedFileOfferEnvelope(
    val envelope: RelayEnvelope,
    val payload: FileOfferPayload,
    val chunks: List<FileChunkDescriptor>,
    val riskyWarning: String?
)

sealed interface FileTransferControlMessage {
    data class Offer(val payload: FileOfferPayload) : FileTransferControlMessage
    data class Accept(val payload: FileAcceptPayload) : FileTransferControlMessage
    data class Reject(val payload: FileRejectPayload) : FileTransferControlMessage
    data class Chunk(val payload: FileChunkPayload) : FileTransferControlMessage
    data class Progress(val payload: FileProgressPayload) : FileTransferControlMessage
    data class Complete(val payload: FileCompletePayload) : FileTransferControlMessage
    data class Cancel(val payload: FileCancelPayload) : FileTransferControlMessage
}

data class DecodedFileTransferEnvelope(
    val envelope: RelayEnvelope,
    val controlMessage: FileTransferControlMessage
)

fun createFileOfferEnvelope(
    fromDeviceId: String,
    toDeviceId: String,
    fileName: String,
    mimeType: String,
    bytes: ByteArray,
    direction: String,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String,
    transferId: String = randomTransferId(),
    chunkSize: Int = DEFAULT_FILE_CHUNK_BYTES,
    now: Long = System.currentTimeMillis()
): CreatedFileOfferEnvelope {
    val payload = FileOfferPayload(
        transferId = transferId,
        fromDeviceId = fromDeviceId,
        toDeviceId = toDeviceId,
        fileName = fileName,
        fileSize = bytes.size.toLong(),
        mimeType = mimeType.ifBlank { "application/octet-stream" },
        sha256 = sha256Hex(bytes),
        direction = direction,
        createdAt = now
    )
    return CreatedFileOfferEnvelope(
        envelope = createRelayPayloadEnvelope(
            fromDeviceId = fromDeviceId,
            toDeviceId = toDeviceId,
            type = FILE_OFFER_TYPE,
            payload = payload.toJson(),
            localPrivateKey = localPrivateKey,
            localPublicKey = localPublicKey,
            peerPublicKey = peerPublicKey,
            now = now
        ),
        payload = payload,
        chunks = splitIntoFileChunks(transferId, bytes, chunkSize, fromDeviceId, toDeviceId),
        riskyWarning = summarizeRiskyFileWarning(fileName)
    )
}

fun createFileChunkEnvelope(
    fromDeviceId: String,
    toDeviceId: String,
    payload: FileChunkPayload,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String,
    now: Long = System.currentTimeMillis()
): RelayEnvelope = createRelayPayloadEnvelope(
    fromDeviceId = fromDeviceId,
    toDeviceId = toDeviceId,
    type = FILE_CHUNK_TYPE,
    payload = payload.toJson(),
    localPrivateKey = localPrivateKey,
    localPublicKey = localPublicKey,
    peerPublicKey = peerPublicKey,
    now = now
)

fun createFileAcceptEnvelope(
    fromDeviceId: String,
    toDeviceId: String,
    transferId: String,
    accepted: Boolean = true,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String,
    now: Long = System.currentTimeMillis()
): RelayEnvelope = createRelayPayloadEnvelope(
    fromDeviceId = fromDeviceId,
    toDeviceId = toDeviceId,
    type = FILE_ACCEPT_TYPE,
    payload = FileAcceptPayload(transferId, fromDeviceId, toDeviceId, accepted, now).toJson(),
    localPrivateKey = localPrivateKey,
    localPublicKey = localPublicKey,
    peerPublicKey = peerPublicKey,
    now = now
)

fun createFileRejectEnvelope(
    fromDeviceId: String,
    toDeviceId: String,
    transferId: String,
    reason: String,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String,
    now: Long = System.currentTimeMillis()
): RelayEnvelope = createRelayPayloadEnvelope(
    fromDeviceId = fromDeviceId,
    toDeviceId = toDeviceId,
    type = FILE_REJECT_TYPE,
    payload = FileRejectPayload(transferId, fromDeviceId, toDeviceId, reason).toJson(),
    localPrivateKey = localPrivateKey,
    localPublicKey = localPublicKey,
    peerPublicKey = peerPublicKey,
    now = now
)

fun createFileProgressEnvelope(
    fromDeviceId: String,
    toDeviceId: String,
    transferId: String,
    bytesTransferred: Long,
    totalBytes: Long,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String,
    now: Long = System.currentTimeMillis()
): RelayEnvelope = createRelayPayloadEnvelope(
    fromDeviceId = fromDeviceId,
    toDeviceId = toDeviceId,
    type = FILE_PROGRESS_TYPE,
    payload = FileProgressPayload(transferId, fromDeviceId, toDeviceId, bytesTransferred, totalBytes).toJson(),
    localPrivateKey = localPrivateKey,
    localPublicKey = localPublicKey,
    peerPublicKey = peerPublicKey,
    now = now
)

fun createFileCompleteEnvelope(
    fromDeviceId: String,
    toDeviceId: String,
    transferId: String,
    sha256: String,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String,
    now: Long = System.currentTimeMillis()
): RelayEnvelope = createRelayPayloadEnvelope(
    fromDeviceId = fromDeviceId,
    toDeviceId = toDeviceId,
    type = FILE_COMPLETE_TYPE,
    payload = FileCompletePayload(transferId, fromDeviceId, toDeviceId, sha256, now).toJson(),
    localPrivateKey = localPrivateKey,
    localPublicKey = localPublicKey,
    peerPublicKey = peerPublicKey,
    now = now
)

fun createFileCancelEnvelope(
    fromDeviceId: String,
    toDeviceId: String,
    transferId: String,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String,
    now: Long = System.currentTimeMillis()
): RelayEnvelope = createRelayPayloadEnvelope(
    fromDeviceId = fromDeviceId,
    toDeviceId = toDeviceId,
    type = FILE_CANCEL_TYPE,
    payload = FileCancelPayload(transferId, fromDeviceId, toDeviceId).toJson(),
    localPrivateKey = localPrivateKey,
    localPublicKey = localPublicKey,
    peerPublicKey = peerPublicKey,
    now = now
)

fun decodeFileTransferEnvelope(
    message: JSONObject,
    localDeviceId: String,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String
): DecodedFileTransferEnvelope? {
    val envelope = message.toFileRelayEnvelope() ?: return null
    val appMessage = try {
        AppMessageCrypto.decrypt(
            envelope = message,
            localDeviceId = localDeviceId,
            localPrivateKey = localPrivateKey,
            localPublicKey = localPublicKey,
            peerPublicKey = peerPublicKey
        )
    } catch (_: Exception) {
        return null
    }
    if (appMessage.id != envelope.messageId ||
        appMessage.fromDeviceId != envelope.fromDeviceId ||
        appMessage.toDeviceId != envelope.toDeviceId
    ) {
        return null
    }
    val payload = appMessage.payload
    val controlMessage = when (appMessage.type) {
        FILE_OFFER_TYPE -> FileTransferControlMessage.Offer(payload.toFileOfferPayload() ?: return null)
        FILE_ACCEPT_TYPE -> FileTransferControlMessage.Accept(payload.toFileAcceptPayload() ?: return null)
        FILE_REJECT_TYPE -> FileTransferControlMessage.Reject(payload.toFileRejectPayload() ?: return null)
        FILE_CHUNK_TYPE -> FileTransferControlMessage.Chunk(payload.toFileChunkPayload() ?: return null)
        FILE_PROGRESS_TYPE -> FileTransferControlMessage.Progress(payload.toFileProgressPayload() ?: return null)
        FILE_COMPLETE_TYPE -> FileTransferControlMessage.Complete(payload.toFileCompletePayload() ?: return null)
        FILE_CANCEL_TYPE -> FileTransferControlMessage.Cancel(payload.toFileCancelPayload() ?: return null)
        else -> return null
    }
    return DecodedFileTransferEnvelope(envelope, controlMessage)
}

fun splitIntoFileChunks(
    transferId: String,
    bytes: ByteArray,
    chunkSize: Int = DEFAULT_FILE_CHUNK_BYTES,
    fromDeviceId: String = "file_sender",
    toDeviceId: String = "file_receiver"
): List<FileChunkDescriptor> {
    require(chunkSize > 0) { "chunkSize must be positive." }
    val totalChunks = maxOf(1, (bytes.size + chunkSize - 1) / chunkSize)
    return (0 until totalChunks).map { chunkIndex ->
        val start = chunkIndex * chunkSize
        val end = minOf(bytes.size, start + chunkSize)
        val chunkBytes = bytes.copyOfRange(start, end)
        FileChunkDescriptor(
            bytes = chunkBytes,
            payload = FileChunkPayload(
                transferId = transferId,
                fromDeviceId = fromDeviceId,
                toDeviceId = toDeviceId,
                chunkIndex = chunkIndex,
                totalChunks = totalChunks,
                byteLength = chunkBytes.size,
                chunkHash = sha256Hex(chunkBytes),
                data = Base64.getEncoder().encodeToString(chunkBytes)
            )
        )
    }
}

fun reassembleTransferredFile(chunks: List<FileChunkPayload>, expectedSha256: String? = null): ByteArray {
    val sorted = chunks.sortedBy { it.chunkIndex }
    val merged = ArrayList<Byte>()
    sorted.forEach { chunk ->
        val bytes = Base64.getDecoder().decode(chunk.data)
        require(bytes.size == chunk.byteLength) { "Chunk ${chunk.chunkIndex} length did not match." }
        require(sha256Hex(bytes) == chunk.chunkHash) { "Chunk ${chunk.chunkIndex} SHA-256 did not match." }
        bytes.forEach { merged += it }
    }
    val output = merged.toByteArray()
    if (expectedSha256 != null) {
        require(sha256Hex(output) == expectedSha256) { "Transferred file SHA-256 did not match." }
    }
    return output
}

fun summarizeRiskyFileWarning(fileName: String): String? {
    return if (isRiskyFileName(fileName)) "Potentially risky file type: $fileName" else null
}

fun isRiskyFileName(fileName: String): Boolean {
    val normalized = fileName.trim().lowercase()
    val extension = normalized.substringAfterLast('.', "")
    if (extension.isBlank()) return false
    return extension in riskyFileExtensions
}

fun sha256Hex(bytes: ByteArray): String {
    return MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { byte ->
        "%02x".format(byte)
    }
}

private fun createRelayPayloadEnvelope(
    fromDeviceId: String,
    toDeviceId: String,
    type: String,
    payload: JSONObject,
    localPrivateKey: String,
    localPublicKey: String,
    peerPublicKey: String,
    now: Long
): RelayEnvelope {
    val message = SecureAppMessage(
        id = "msg_${UUID.randomUUID().toString().replace("-", "")}",
        type = type,
        timestamp = now,
        fromDeviceId = fromDeviceId,
        toDeviceId = toDeviceId,
        payload = payload
    )
    return AppMessageCrypto.encrypt(
        message = message,
        localPrivateKey = localPrivateKey,
        localPublicKey = localPublicKey,
        peerPublicKey = peerPublicKey
    ).toFileRelayEnvelope() ?: error("Encrypted file-transfer envelope was invalid.")
}

private fun randomTransferId(): String = "transfer_${UUID.randomUUID().toString().replace("-", "")}"

private val riskyFileExtensions = setOf("exe", "msi", "bat", "cmd", "ps1", "vbs", "scr", "js", "jar")

private fun JSONObject.toFileRelayEnvelope(): RelayEnvelope? {
    if (optInt("version") != 1) return null
    return try {
        RelayEnvelope(
            fromDeviceId = getString("fromDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
            toDeviceId = getString("toDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
            messageId = getString("messageId").trim().takeIf { it.isNotBlank() } ?: return null,
            timestamp = getLong("timestamp"),
            nonce = getString("nonce").trim().takeIf { it.isNotBlank() } ?: return null,
            ciphertext = getString("ciphertext").trim().takeIf { it.isNotBlank() } ?: return null,
            algorithm = optString("algorithm").trim().takeIf { it.isNotBlank() },
            keyId = optString("keyId").trim().takeIf { it.isNotBlank() }
        )
    } catch (_: JSONException) {
        null
    }
}

private fun JSONObject.toFileOfferPayload(): FileOfferPayload? {
    return try {
        FileOfferPayload(
        transferId = getString("transferId").trim().takeIf { it.isNotBlank() } ?: return null,
        fromDeviceId = getString("fromDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
        toDeviceId = getString("toDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
        fileName = getString("fileName").trim().takeIf { it.isNotBlank() } ?: return null,
        fileSize = getLong("fileSize").takeIf { it >= 0 } ?: return null,
        mimeType = getString("mimeType").trim().takeIf { it.isNotBlank() } ?: return null,
        sha256 = getString("sha256").trim().takeIf { it.isHexSha256() } ?: return null,
        direction = getString("direction").trim().takeIf {
            it == "ANDROID_TO_WINDOWS" || it == "WINDOWS_TO_ANDROID"
        } ?: return null,
        createdAt = getLong("createdAt").takeIf { it >= 0 } ?: return null
    )
    } catch (_: JSONException) {
        null
    }
}

private fun JSONObject.toFileAcceptPayload(): FileAcceptPayload? {
    return try {
        if (!has("accepted")) return null
        FileAcceptPayload(
        transferId = getString("transferId").trim().takeIf { it.isNotBlank() } ?: return null,
        fromDeviceId = getString("fromDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
        toDeviceId = getString("toDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
        accepted = getBoolean("accepted"),
        acceptedAt = getLong("acceptedAt").takeIf { it >= 0 } ?: return null
    )
    } catch (_: JSONException) {
        null
    }
}

private fun JSONObject.toFileRejectPayload(): FileRejectPayload? {
    return try {
        FileRejectPayload(
        transferId = getString("transferId").trim().takeIf { it.isNotBlank() } ?: return null,
        fromDeviceId = getString("fromDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
        toDeviceId = getString("toDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
        reason = getString("reason").trim().takeIf { it.isNotBlank() } ?: return null
    )
    } catch (_: JSONException) {
        null
    }
}

private fun JSONObject.toFileChunkPayload(): FileChunkPayload? {
    return try {
        FileChunkPayload(
        transferId = getString("transferId").trim().takeIf { it.isNotBlank() } ?: return null,
        fromDeviceId = getString("fromDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
        toDeviceId = getString("toDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
        chunkIndex = getInt("chunkIndex").takeIf { it >= 0 } ?: return null,
        totalChunks = getInt("totalChunks").takeIf { it > 0 } ?: return null,
        byteLength = getInt("byteLength").takeIf { it >= 0 } ?: return null,
        chunkHash = getString("chunkHash").trim().takeIf { it.isHexSha256() } ?: return null,
        data = getString("data").trim().takeIf { it.isNotBlank() } ?: return null
    )
    } catch (_: JSONException) {
        null
    }
}

private fun JSONObject.toFileProgressPayload(): FileProgressPayload? {
    return try {
        FileProgressPayload(
        transferId = getString("transferId").trim().takeIf { it.isNotBlank() } ?: return null,
        fromDeviceId = getString("fromDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
        toDeviceId = getString("toDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
        bytesTransferred = getLong("bytesTransferred").takeIf { it >= 0 } ?: return null,
        totalBytes = getLong("totalBytes").takeIf { it >= 0 } ?: return null
    )
    } catch (_: JSONException) {
        null
    }
}

private fun JSONObject.toFileCompletePayload(): FileCompletePayload? {
    return try {
        FileCompletePayload(
        transferId = getString("transferId").trim().takeIf { it.isNotBlank() } ?: return null,
        fromDeviceId = getString("fromDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
        toDeviceId = getString("toDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
        sha256 = getString("sha256").trim().takeIf { it.isHexSha256() } ?: return null,
        completedAt = getLong("completedAt").takeIf { it >= 0 } ?: return null
    )
    } catch (_: JSONException) {
        null
    }
}

private fun JSONObject.toFileCancelPayload(): FileCancelPayload? {
    return try {
        FileCancelPayload(
        transferId = getString("transferId").trim().takeIf { it.isNotBlank() } ?: return null,
        fromDeviceId = getString("fromDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
        toDeviceId = getString("toDeviceId").trim().takeIf { it.isNotBlank() } ?: return null,
        reason = optString("reason").trim().takeIf { it.isNotBlank() }
    )
    } catch (_: JSONException) {
        null
    }
}

private fun FileOfferPayload.toJson(): JSONObject = JSONObject()
    .put("transferId", transferId)
    .put("fromDeviceId", fromDeviceId)
    .put("toDeviceId", toDeviceId)
    .put("fileName", fileName)
    .put("fileSize", fileSize)
    .put("mimeType", mimeType)
    .put("sha256", sha256)
    .put("direction", direction)
    .put("createdAt", createdAt)

private fun FileAcceptPayload.toJson(): JSONObject = JSONObject()
    .put("transferId", transferId)
    .put("fromDeviceId", fromDeviceId)
    .put("toDeviceId", toDeviceId)
    .put("accepted", accepted)
    .put("acceptedAt", acceptedAt)

private fun FileRejectPayload.toJson(): JSONObject = JSONObject()
    .put("transferId", transferId)
    .put("fromDeviceId", fromDeviceId)
    .put("toDeviceId", toDeviceId)
    .put("reason", reason)

private fun FileChunkPayload.toJson(): JSONObject = JSONObject()
    .put("transferId", transferId)
    .put("fromDeviceId", fromDeviceId)
    .put("toDeviceId", toDeviceId)
    .put("chunkIndex", chunkIndex)
    .put("totalChunks", totalChunks)
    .put("byteLength", byteLength)
    .put("chunkHash", chunkHash)
    .put("data", data)

private fun FileProgressPayload.toJson(): JSONObject = JSONObject()
    .put("transferId", transferId)
    .put("fromDeviceId", fromDeviceId)
    .put("toDeviceId", toDeviceId)
    .put("bytesTransferred", bytesTransferred)
    .put("totalBytes", totalBytes)

private fun FileCompletePayload.toJson(): JSONObject = JSONObject()
    .put("transferId", transferId)
    .put("fromDeviceId", fromDeviceId)
    .put("toDeviceId", toDeviceId)
    .put("sha256", sha256)
    .put("completedAt", completedAt)

private fun FileCancelPayload.toJson(): JSONObject = JSONObject()
    .put("transferId", transferId)
    .put("fromDeviceId", fromDeviceId)
    .put("toDeviceId", toDeviceId)
    .also { json ->
        if (reason != null) json.put("reason", reason)
    }

private fun String.isHexSha256(): Boolean = matches(Regex("^[a-fA-F0-9]{64}$"))
