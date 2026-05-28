package dev.crossbridge.android.network

import android.content.Context
import android.os.Environment
import dev.crossbridge.android.CrossBridgeNotificationListenerService
import dev.crossbridge.android.data.AndroidIdentityStore
import dev.crossbridge.android.data.RelayUrlStore
import dev.crossbridge.android.data.TrustedDeviceStore
import dev.crossbridge.android.protocol.DeviceIdentity
import dev.crossbridge.android.protocol.TrustedDevice
import dev.crossbridge.android.protocol.LanDiscoveryProbePayload
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

enum class ConnectionPhase {
    NOT_PAIRED,
    PAIRED_DISCONNECTED,
    CONNECTING,
    CONNECTED_TO_RELAY,
    WINDOWS_DEVICE_ONLINE,
    RECONNECTING,
    ERROR
}

enum class FileTransferStatus {
    OFFERED,
    ACCEPTED,
    REJECTED,
    TRANSFERRING,
    COMPLETED,
    FAILED,
    CANCELLED
}

data class FileTransferState(
    val transferId: String,
    val peerDeviceId: String,
    val fileName: String,
    val fileSize: Long,
    val direction: String, // "ANDROID_TO_WINDOWS" or "WINDOWS_TO_ANDROID"
    val bytesTransferred: Long,
    val status: FileTransferStatus,
    val progress: Int,
    val error: String? = null,
    val riskyWarning: String? = null,
    val sha256: String,
    val mimeType: String? = null,
    val savedPath: String? = null
)

data class TrustedDeviceConnection(
    val device: TrustedDevice,
    val online: Boolean,
    val connectionMode: String? = null,
    val lastSeenAt: Long? = device.lastSeenAt,
    val localFastPathAvailable: Boolean = false
)

data class ConnectionViewState(
    val phase: ConnectionPhase = ConnectionPhase.PAIRED_DISCONNECTED,
    val relayConnectionState: RelayConnectionState = RelayConnectionState.DISCONNECTED,
    val relayUrl: String = "ws://10.0.2.2:8787/connect",
    val androidIdentity: DeviceIdentity? = null,
    val trustedDevices: List<TrustedDeviceConnection> = emptyList(),
    val sentShares: List<SentShare> = emptyList(),
    val receivedShares: List<ReceivedShare> = emptyList(),
    val transfers: List<FileTransferState> = emptyList(),
    val shareError: String? = null,
    val error: String? = null
)

class ConnectionManager(
    context: Context,
    private val relayClient: RelayClient = RelayClient()
) {
    private val appContext = context.applicationContext
    private val identityStore = AndroidIdentityStore(appContext)
    private val trustedDeviceStore = TrustedDeviceStore(appContext)
    private val relayUrlStore = RelayUrlStore(appContext)
    private val replayProtector = ReplayProtector(appContext)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val activeFileTransfers = HashMap<String, Pair<ByteArray, List<FileChunkDescriptor>>>()
    private val receivedChunks = HashMap<String, ArrayList<FileChunkPayload>>()
    private val unsubscribeRelayMessages: () -> Unit
    private val unsubscribeRelayState: () -> Unit
    @Volatile
    private var started = false
    @Volatile
    private var verifiedWindowsIp: String? = null
    private val _viewState = MutableStateFlow(
        ConnectionViewState(relayUrl = relayUrlStore.loadRelayUrl())
    )

    val viewState: StateFlow<ConnectionViewState> = _viewState.asStateFlow()

    init {
        unsubscribeRelayMessages = relayClient.onMessage { message ->
            handleRelayMessage(message)
        }
        unsubscribeRelayState = relayClient.onStateChange { relayState ->
            handleRelayState(relayState)
        }
        NotificationMirrorBridge.register(
            onPosted = ::mirrorNotificationPosted,
            onRemoved = ::mirrorNotificationRemoved
        )
    }

    @Synchronized
    fun start() {
        if (started) {
            return
        }
        started = true
        scope.launch {
            refreshTrustedDevices()
        }
    }

    fun reconnectNow() {
        scope.launch {
            connectIfTrusted(forceReconnect = true, announceIfConnected = true)
        }
    }

    fun setRelayUrl(relayUrl: String) {
        val trimmed = relayUrl.trim()
        _viewState.update {
            it.copy(relayUrl = trimmed, error = null)
                .withPhase()
        }
        relayUrlStore.saveRelayUrl(trimmed)
    }

    fun removeTrustedDevice(deviceId: String) {
        scope.launch {
            trustedDeviceStore.removeTrustedDevice(deviceId)
            refreshTrustedDevices()
        }
    }

    fun sendTextShare(toDeviceId: String, text: String) {
        scope.launch {
            val current = _viewState.value
            val target = current.trustedDevices.firstOrNull { it.device.deviceId == toDeviceId }
            if (target == null) {
                _viewState.update {
                    it.copy(shareError = "Failed to send because the device is not trusted yet.")
                        .withPhase()
                }
                return@launch
            }

            if (!target.online || current.relayConnectionState != RelayConnectionState.CONNECTED) {
                _viewState.update {
                    it.copy(shareError = "Failed to send because the device is offline.")
                        .withPhase()
                }
                return@launch
            }

            try {
                val cryptoIdentity = identityStore.loadOrCreateCryptoIdentity()
                val identity = cryptoIdentity.identity
                val created = createTextShareEnvelope(
                    fromDeviceId = identity.deviceId,
                    toDeviceId = toDeviceId,
                    text = text,
                    localPrivateKey = cryptoIdentity.privateKey,
                    localPublicKey = identity.publicKey,
                    peerPublicKey = target.device.publicKey
                )
                _viewState.update {
                    it.copy(
                        androidIdentity = identity,
                        sentShares = addSendingShare(
                            sentShares = it.sentShares,
                            payload = created.payload,
                            messageId = created.envelope.messageId,
                            targetDevice = target.device
                        ),
                        shareError = null
                    ).withPhase()
                }
                relayClient.send(created.envelope.toJson())
            } catch (error: Throwable) {
                val message = error.message ?: "Failed to send through the relay."
                _viewState.update {
                    it.copy(
                        sentShares = markMostRecentSendingShareFailed(it.sentShares, message),
                        shareError = message
                    ).withPhase()
                }
            }
        }
    }

    fun sendFileOffer(toDeviceId: String, fileName: String, mimeType: String, bytes: ByteArray) {
        scope.launch {
            val current = _viewState.value
            val target = current.trustedDevices.firstOrNull { it.device.deviceId == toDeviceId }
            if (target == null) {
                _viewState.update {
                    it.copy(shareError = "Failed to send because the device is not trusted yet.")
                        .withPhase()
                }
                return@launch
            }

            if (!target.online || current.relayConnectionState != RelayConnectionState.CONNECTED) {
                _viewState.update {
                    it.copy(shareError = "Failed to send because the device is offline.")
                        .withPhase()
                }
                return@launch
            }

            try {
                val cryptoIdentity = identityStore.loadOrCreateCryptoIdentity()
                val identity = cryptoIdentity.identity
                val created = createFileOfferEnvelope(
                    fromDeviceId = identity.deviceId,
                    toDeviceId = toDeviceId,
                    fileName = fileName,
                    mimeType = mimeType,
                    bytes = bytes,
                    direction = "ANDROID_TO_WINDOWS",
                    localPrivateKey = cryptoIdentity.privateKey,
                    localPublicKey = identity.publicKey,
                    peerPublicKey = target.device.publicKey
                )

                val transferState = FileTransferState(
                    transferId = created.payload.transferId,
                    peerDeviceId = toDeviceId,
                    fileName = fileName,
                    fileSize = bytes.size.toLong(),
                    direction = "ANDROID_TO_WINDOWS",
                    bytesTransferred = 0,
                    status = FileTransferStatus.OFFERED,
                    progress = 0,
                    riskyWarning = created.riskyWarning,
                    sha256 = created.payload.sha256,
                    mimeType = mimeType
                )

                activeFileTransfers[created.payload.transferId] = Pair(bytes, created.chunks)

                _viewState.update {
                    it.copy(
                        androidIdentity = identity,
                        transfers = (listOf(transferState) + it.transfers).take(50),
                        shareError = null
                    ).withPhase()
                }

                relayClient.send(created.envelope.toJson())
            } catch (error: Throwable) {
                val message = error.message ?: "Failed to send through the relay."
                _viewState.update {
                    it.copy(shareError = message).withPhase()
                }
            }
        }
    }

    fun acceptFileOffer(transferId: String) {
        scope.launch {
            val transfer = _viewState.value.transfers.firstOrNull { it.transferId == transferId } ?: return@launch
            val target = _viewState.value.trustedDevices.firstOrNull { it.device.deviceId == transfer.peerDeviceId } ?: return@launch

            try {
                val cryptoIdentity = identityStore.loadOrCreateCryptoIdentity()
                val identity = cryptoIdentity.identity
                val envelope = createFileAcceptEnvelope(
                    fromDeviceId = identity.deviceId,
                    toDeviceId = transfer.peerDeviceId,
                    transferId = transferId,
                    accepted = true,
                    localPrivateKey = cryptoIdentity.privateKey,
                    localPublicKey = identity.publicKey,
                    peerPublicKey = target.device.publicKey
                )

                receivedChunks[transferId] = ArrayList()

                _viewState.update { current ->
                    current.copy(
                        transfers = current.transfers.map { t ->
                            if (t.transferId == transferId) t.copy(status = FileTransferStatus.ACCEPTED) else t
                        }
                    ).withPhase()
                }

                // If direct local path is verified and available, start background TCP receiver
                val useLan = target.localFastPathAvailable && verifiedWindowsIp != null
                if (useLan) {
                    scope.launch {
                        startListeningForLanChunks(transferId, target.device)
                    }
                }

                relayClient.send(envelope.toJson())
            } catch (error: Throwable) {
                val message = error.message ?: "Failed to accept file transfer."
                _viewState.update {
                    it.copy(shareError = message).withPhase()
                }
            }
        }
    }

    fun rejectFileOffer(transferId: String, reason: String = "Declined by recipient") {
        scope.launch {
            val transfer = _viewState.value.transfers.firstOrNull { it.transferId == transferId } ?: return@launch
            val target = _viewState.value.trustedDevices.firstOrNull { it.device.deviceId == transfer.peerDeviceId } ?: return@launch

            try {
                val cryptoIdentity = identityStore.loadOrCreateCryptoIdentity()
                val identity = cryptoIdentity.identity
                val envelope = createFileRejectEnvelope(
                    fromDeviceId = identity.deviceId,
                    toDeviceId = transfer.peerDeviceId,
                    transferId = transferId,
                    reason = reason,
                    localPrivateKey = cryptoIdentity.privateKey,
                    localPublicKey = identity.publicKey,
                    peerPublicKey = target.device.publicKey
                )

                _viewState.update { current ->
                    current.copy(
                        transfers = current.transfers.map { t ->
                            if (t.transferId == transferId) t.copy(status = FileTransferStatus.REJECTED, error = reason) else t
                        }
                    ).withPhase()
                }

                relayClient.send(envelope.toJson())
            } catch (error: Throwable) {
                val message = error.message ?: "Failed to reject file transfer."
                _viewState.update {
                    it.copy(shareError = message).withPhase()
                }
            }
        }
    }

    fun cancelFileTransfer(transferId: String, reason: String = "Cancelled by user") {
        scope.launch {
            val transfer = _viewState.value.transfers.firstOrNull { it.transferId == transferId } ?: return@launch

            activeFileTransfers.remove(transferId)
            receivedChunks.remove(transferId)

            val target = _viewState.value.trustedDevices.firstOrNull { it.device.deviceId == transfer.peerDeviceId }
            if (target != null && target.online && _viewState.value.relayConnectionState == RelayConnectionState.CONNECTED) {
                try {
                    val cryptoIdentity = identityStore.loadOrCreateCryptoIdentity()
                    val identity = cryptoIdentity.identity
                    val envelope = createFileCancelEnvelope(
                        fromDeviceId = identity.deviceId,
                        toDeviceId = transfer.peerDeviceId,
                        transferId = transferId,
                        localPrivateKey = cryptoIdentity.privateKey,
                        localPublicKey = identity.publicKey,
                        peerPublicKey = target.device.publicKey
                    )
                    relayClient.send(envelope.toJson())
                } catch (_: Throwable) {}
            }

            _viewState.update { current ->
                current.copy(
                    transfers = current.transfers.map { t ->
                        if (t.transferId == transferId) t.copy(status = FileTransferStatus.CANCELLED, error = reason) else t
                    }
                ).withPhase()
            }
        }
    }

    private fun startSendingFileChunks(transferId: String) {
        scope.launch {
            val cached = activeFileTransfers[transferId] ?: return@launch
            val transfer = _viewState.value.transfers.firstOrNull { it.transferId == transferId } ?: return@launch
            val target = _viewState.value.trustedDevices.firstOrNull { it.device.deviceId == transfer.peerDeviceId } ?: return@launch

            // Direct local TCP transport is a performance fast path. Relay mode remains first-class and VPN-safe.
            val useLan = target.localFastPathAvailable && verifiedWindowsIp != null

            val lanConnection = if (useLan) {
                try {
                    kotlinx.coroutines.withContext(Dispatchers.IO) {
                        val sock = java.net.Socket()
                        sock.connect(java.net.InetSocketAddress(verifiedWindowsIp, 8789), 2000)
                        val w = sock.getOutputStream().bufferedWriter()
                        w.write("CROSSBRIDGE_FILE_HANDSHAKE:{\"transferId\":\"$transferId\",\"mode\":\"send\"}\n")
                        w.flush()
                        Pair(sock, w)
                    }
                } catch (e: Exception) {
                    android.util.Log.e("CrossBridgeLAN", "Failed to connect to direct TCP socket, falling back to relay", e)
                    null
                }
            } else {
                null
            }

            val socket = lanConnection?.first
            val writer = lanConnection?.second
            var failedLan = lanConnection == null

            try {
                val cryptoIdentity = identityStore.loadOrCreateCryptoIdentity()
                val identity = cryptoIdentity.identity

                var bytesTransferred = 0L
                for (chunk in cached.second) {
                    val currentTransfer = _viewState.value.transfers.firstOrNull { it.transferId == transferId }
                    if (currentTransfer == null || currentTransfer.status != FileTransferStatus.TRANSFERRING) {
                        return@launch
                    }

                    val envelope = createFileChunkEnvelope(
                        fromDeviceId = identity.deviceId,
                        toDeviceId = transfer.peerDeviceId,
                        payload = chunk.payload,
                        localPrivateKey = cryptoIdentity.privateKey,
                        localPublicKey = identity.publicKey,
                        peerPublicKey = target.device.publicKey
                    )

                    if (useLan && !failedLan && writer != null) {
                        try {
                            kotlinx.coroutines.withContext(Dispatchers.IO) {
                                writer.write(envelope.toJson().toString() + "\n")
                                writer.flush()
                            }
                        } catch (e: Exception) {
                            android.util.Log.e("CrossBridgeLAN", "Failed to send chunk over local TCP, falling back to relay", e)
                            failedLan = true
                            relayClient.send(envelope.toJson())
                        }
                    } else {
                        relayClient.send(envelope.toJson())
                    }

                    bytesTransferred += chunk.payload.byteLength
                    val progress = (bytesTransferred * 100 / currentTransfer.fileSize).toInt()

                    _viewState.update { current ->
                        current.copy(
                            transfers = current.transfers.map { t ->
                                if (t.transferId == transferId) {
                                    t.copy(bytesTransferred = bytesTransferred, progress = progress)
                                } else t
                            }
                        ).withPhase()
                    }

                    kotlinx.coroutines.delay(10)
                }

                val finalTransfer = _viewState.value.transfers.firstOrNull { it.transferId == transferId }
                if (finalTransfer != null && finalTransfer.status == FileTransferStatus.TRANSFERRING) {
                    val completeEnvelope = createFileCompleteEnvelope(
                        fromDeviceId = identity.deviceId,
                        toDeviceId = transfer.peerDeviceId,
                        transferId = transferId,
                        sha256 = transfer.sha256,
                        localPrivateKey = cryptoIdentity.privateKey,
                        localPublicKey = identity.publicKey,
                        peerPublicKey = target.device.publicKey
                    )

                    if (useLan && !failedLan && writer != null) {
                        try {
                            kotlinx.coroutines.withContext(Dispatchers.IO) {
                                writer.write(completeEnvelope.toJson().toString() + "\n")
                                writer.flush()
                            }
                        } catch (e: Exception) {
                            android.util.Log.e("CrossBridgeLAN", "Failed to send complete over direct TCP, falling back to relay", e)
                            relayClient.send(completeEnvelope.toJson())
                        }
                    } else {
                        relayClient.send(completeEnvelope.toJson())
                    }

                    _viewState.update { current ->
                        current.copy(
                            transfers = current.transfers.map { t ->
                                if (t.transferId == transferId) {
                                    t.copy(status = FileTransferStatus.COMPLETED, progress = 100)
                                } else t
                            }
                        ).withPhase()
                    }
                }
            } catch (error: Throwable) {
                val message = error.message ?: "Failed to transmit file chunks."
                _viewState.update { current ->
                    current.copy(
                        transfers = current.transfers.map { t ->
                            if (t.transferId == transferId) {
                                t.copy(status = FileTransferStatus.FAILED, error = message)
                            } else t
                        }
                    ).withPhase()
                }
            } finally {
                activeFileTransfers.remove(transferId)
                try {
                    writer?.close()
                    socket?.close()
                } catch (_: Exception) {}
            }
        }
    }

    private fun startListeningForLanChunks(transferId: String, targetDevice: TrustedDevice) {
        var socket: java.net.Socket? = null
        var reader: java.io.BufferedReader? = null
        try {
            socket = java.net.Socket()
            socket.connect(java.net.InetSocketAddress(verifiedWindowsIp, 8789), 2000)
            val w = socket.getOutputStream().bufferedWriter()
            w.write("CROSSBRIDGE_FILE_HANDSHAKE:{\"transferId\":\"$transferId\",\"mode\":\"receive\"}\n")
            w.flush()

            reader = socket.getInputStream().bufferedReader()
            while (true) {
                val line = reader.readLine() ?: break
                val trimmed = line.trim()
                if (trimmed.isNotEmpty()) {
                    try {
                        val envelope = JSONObject(trimmed)
                        handleRelayMessage(envelope)
                    } catch (e: Exception) {
                        android.util.Log.e("CrossBridgeLAN", "Failed to parse LAN chunk", e)
                    }
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("CrossBridgeLAN", "LAN chunk receiver connection failed or disconnected", e)
        } finally {
            try {
                reader?.close()
                socket?.close()
            } catch (_: Exception) {}
        }
    }

    private fun saveFile(fileName: String, bytes: ByteArray): String? {
        return try {
            val dir = appContext.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: appContext.cacheDir
            val file = File(dir, fileName)
            FileOutputStream(file).use { out ->
                out.write(bytes)
            }
            file.absolutePath
        } catch (_: Exception) {
            null
        }
    }

    fun refreshAfterPairingComplete() {
        start()
        scope.launch {
            val identity = identityStore.loadOrCreateIdentity()
            _viewState.update { it.copy(androidIdentity = identity) }
            refreshTrustedDevices()
        }
    }

    fun dispose() {
        NotificationMirrorBridge.unregister()
        unsubscribeRelayMessages()
        unsubscribeRelayState()
        relayClient.close()
        scope.cancel()
    }

    private fun mirrorNotificationPosted(payload: NotificationPostedPayload) {
        scope.launch {
            val current = _viewState.value
            if (current.relayConnectionState != RelayConnectionState.CONNECTED) return@launch
            val targets = current.trustedDevices.filter { it.online && it.device.platform == "windows" }
            if (targets.isEmpty()) return@launch

            try {
                val cryptoIdentity = identityStore.loadOrCreateCryptoIdentity()
                val identity = cryptoIdentity.identity
                targets.forEach { target ->
                    val envelope = createNotificationPostedEnvelope(
                        fromDeviceId = identity.deviceId,
                        toDeviceId = target.device.deviceId,
                        payload = payload,
                        localPrivateKey = cryptoIdentity.privateKey,
                        localPublicKey = identity.publicKey,
                        peerPublicKey = target.device.publicKey
                    )
                    relayClient.send(envelope.toJson())
                }
            } catch (error: Throwable) {
                _viewState.update {
                    it.copy(shareError = error.message ?: "Failed to mirror notification.").withPhase()
                }
            }
        }
    }

    private fun mirrorNotificationRemoved(payload: NotificationRemovedPayload) {
        scope.launch {
            val current = _viewState.value
            if (current.relayConnectionState != RelayConnectionState.CONNECTED) return@launch
            val targets = current.trustedDevices.filter { it.online && it.device.platform == "windows" }
            if (targets.isEmpty()) return@launch

            try {
                val cryptoIdentity = identityStore.loadOrCreateCryptoIdentity()
                val identity = cryptoIdentity.identity
                targets.forEach { target ->
                    val envelope = createNotificationRemovedEnvelope(
                        fromDeviceId = identity.deviceId,
                        toDeviceId = target.device.deviceId,
                        payload = payload,
                        localPrivateKey = cryptoIdentity.privateKey,
                        localPublicKey = identity.publicKey,
                        peerPublicKey = target.device.publicKey
                    )
                    relayClient.send(envelope.toJson())
                }
            } catch (_: Throwable) {
                // Removal updates are best-effort metadata cleanup.
            }
        }
    }

    private fun handleIncomingNotificationDismiss(
        source: TrustedDevice,
        identity: DeviceIdentity,
        localPrivateKey: String,
        payload: NotificationDismissPayload
    ) {
        scope.launch {
            val result = CrossBridgeNotificationListenerService.dismissMirroredNotification(payload.notificationId)

            if (!result.dismissed) {
                _viewState.update {
                    it.copy(
                        shareError = result.message ?: "Android could not dismiss that notification."
                    ).withPhase()
                }
            }

            try {
                val envelope = createNotificationDismissResultEnvelope(
                    fromDeviceId = identity.deviceId,
                    toDeviceId = source.deviceId,
                    payload = result,
                    localPrivateKey = localPrivateKey,
                    localPublicKey = identity.publicKey,
                    peerPublicKey = source.publicKey
                )
                relayClient.send(envelope.toJson())
                persistLastSeen(source.deviceId, System.currentTimeMillis())
            } catch (_: Throwable) {
                if (!result.dismissed) {
                    _viewState.update {
                        it.copy(
                            shareError = "Android could not report the dismiss failure back to Windows."
                        ).withPhase()
                    }
                }
            }
        }
    }

    private fun handleIncomingNotificationReply(
        source: TrustedDevice,
        identity: DeviceIdentity,
        localPrivateKey: String,
        payload: NotificationReplyPayload
    ) {
        scope.launch {
            val result = CrossBridgeNotificationListenerService.replyToMirroredNotification(
                notificationId = payload.notificationId,
                actionId = payload.actionId,
                replyText = payload.replyText
            )

            if (!result.replied) {
                _viewState.update {
                    it.copy(
                        shareError = result.message ?: "Android could not send that reply."
                    ).withPhase()
                }
            }

            try {
                val envelope = createNotificationReplyResultEnvelope(
                    fromDeviceId = identity.deviceId,
                    toDeviceId = source.deviceId,
                    payload = result,
                    localPrivateKey = localPrivateKey,
                    localPublicKey = identity.publicKey,
                    peerPublicKey = source.publicKey
                )
                relayClient.send(envelope.toJson())
                persistLastSeen(source.deviceId, System.currentTimeMillis())
            } catch (_: Throwable) {
                if (!result.replied) {
                    _viewState.update {
                        it.copy(
                            shareError = "Android could not report the reply failure back to Windows."
                        ).withPhase()
                    }
                }
            }
        }
    }

    private suspend fun probeLocalCandidatesAndReport(
        targetDevice: TrustedDevice,
        candidates: List<String>,
        port: Int,
        identity: DeviceIdentity,
        cryptoIdentity: dev.crossbridge.android.data.AndroidCryptoIdentity
    ) {
        var success = false
        var verifiedIp: String? = null
        for (ip in candidates) {
            val isReachable = try {
                kotlinx.coroutines.withContext(Dispatchers.IO) {
                    java.net.Socket().use { socket ->
                        socket.connect(java.net.InetSocketAddress(ip, port), 1500)
                        val reader = socket.getInputStream().bufferedReader()
                        val line = reader.readLine()
                        line != null && line.contains("CROSSBRIDGE_PROBE_ACK")
                    }
                }
            } catch (_: Exception) {
                false
            }

            if (isReachable) {
                success = true
                verifiedIp = ip
                break
            }
        }

        if (success) {
            verifiedWindowsIp = verifiedIp
            _viewState.update { current ->
                current.copy(
                    trustedDevices = current.trustedDevices.map { t ->
                        if (t.device.deviceId == targetDevice.deviceId) {
                            t.copy(online = true, connectionMode = "lan", localFastPathAvailable = true)
                        } else t
                    }
                ).withPhase()
            }

            try {
                val envelope = createLanDiscoveryProbeEnvelope(
                    fromDeviceId = identity.deviceId,
                    toDeviceId = targetDevice.deviceId,
                    localIps = emptyList(),
                    port = port,
                    isReachable = true,
                    localPrivateKey = cryptoIdentity.privateKey,
                    localPublicKey = identity.publicKey,
                    peerPublicKey = targetDevice.publicKey
                )
                relayClient.send(envelope.toJson())
            } catch (_: Throwable) {}
        }
    }

    private suspend fun refreshTrustedDevices() {
        val previousPeerIds = trustedPeerIdKey(_viewState.value.trustedDevices)
        val trustedDevices = trustedDeviceStore.loadTrustedDevices()
        _viewState.update {
            it.copy(
                relayUrl = relayUrlStore.loadRelayUrl(),
                trustedDevices = mergeTrustedDevices(it.trustedDevices, trustedDevices),
                error = null
            ).withPhase()
        }
        val nextPeerIds = trustedPeerIdKey(_viewState.value.trustedDevices)
        connectIfTrusted(
            forceReconnect = false,
            announceIfConnected = previousPeerIds != nextPeerIds
        )
    }

    private suspend fun connectIfTrusted(
        forceReconnect: Boolean,
        announceIfConnected: Boolean
    ) {
        val current = _viewState.value
        if (current.trustedDevices.isEmpty()) {
            relayClient.disconnect()
            _viewState.update { it.copy(phase = ConnectionPhase.NOT_PAIRED, error = null) }
            return
        }

        if (!forceReconnect && current.relayConnectionState in connectedOrConnectingStates) {
            if (announceIfConnected) {
                sendTrustedDeviceHello()
            }
            return
        }

        try {
            val identity = current.androidIdentity ?: identityStore.loadOrCreateIdentity()
            _viewState.update {
                it.copy(androidIdentity = identity, error = null)
                    .withPhase()
            }
            relayClient.connect(current.relayUrl)
        } catch (error: Throwable) {
            _viewState.update {
                it.copy(error = error.message ?: "Could not connect to the relay.")
                    .withPhase()
            }
        }
    }

    private fun handleRelayState(relayState: RelayConnectionState) {
        _viewState.update { current ->
            val nextTrustedDevices = if (relayState == RelayConnectionState.CONNECTED) {
                current.trustedDevices
            } else {
                current.trustedDevices.map {
                    it.copy(online = false, connectionMode = null)
                }
            }
            current.copy(
                relayConnectionState = relayState,
                trustedDevices = nextTrustedDevices,
                error = if (relayState == RelayConnectionState.ERROR) current.error else null
            ).withPhase()
        }

        if (relayState == RelayConnectionState.CONNECTED) {
            scope.launch {
                sendRelayHello()
            }
        }
    }

    private suspend fun sendRelayHello() {
        try {
            val identity = _viewState.value.androidIdentity ?: identityStore.loadOrCreateIdentity()
            _viewState.update {
                it.copy(androidIdentity = identity, error = null)
                    .withPhase()
            }
            relayClient.send(
                JSONObject()
                    .put("type", "RELAY_HELLO")
                    .put("deviceId", identity.deviceId)
                    .put("sessionToken", "session_${UUID.randomUUID().toString().replace("-", "")}")
                    .put("protocolVersion", 1)
            )
        } catch (error: Throwable) {
            _viewState.update {
                it.copy(error = error.message ?: "Could not announce this Android device.")
                    .withPhase()
            }
        }
    }

    private suspend fun sendTrustedDeviceHello() {
        val current = _viewState.value
        val identity = current.androidIdentity ?: return
        if (current.trustedDevices.isEmpty()) return
        if (current.relayConnectionState != RelayConnectionState.CONNECTED) return

        val trustedPeerIds = JSONArray()
        current.trustedDevices.forEach { trustedPeerIds.put(it.device.deviceId) }

        relayClient.send(
            JSONObject()
                .put("type", "TRUSTED_DEVICE_HELLO")
                .put(
                    "payload",
                    JSONObject()
                        .put("deviceIdentity", identity.toJson())
                        .put("trustedPeerIds", trustedPeerIds)
                )
        )
    }

    private fun handleRelayMessage(message: JSONObject) {
        parseRelayAck(message)?.let { ack ->
            if (ack.delivered) {
                _viewState.update {
                    it.copy(
                        sentShares = markSentShareSent(it.sentShares, ack.messageId),
                        shareError = null
                    ).withPhase()
                }
            } else {
                val failureMessage = relayAckFailureMessage(ack.reason)
                _viewState.update {
                    it.copy(
                        sentShares = markSentShareFailed(it.sentShares, ack.messageId, failureMessage),
                        shareError = failureMessage
                    ).withPhase()
                }
            }
            return
        }

        when (message.optString("type")) {
            "RELAY_WELCOME" -> {
                val identity = _viewState.value.androidIdentity ?: return
                if (message.optString("deviceId") == identity.deviceId) {
                    scope.launch {
                        sendTrustedDeviceHello()
                    }
                }
            }

            "RELAY_ERROR" -> {
                _viewState.update {
                    it.copy(error = message.optString("message").ifBlank { "Relay returned an error." })
                        .withPhase()
                }
            }

            "TRUSTED_DEVICE_ONLINE" -> handleTrustedDeviceOnline(message)
            "TRUSTED_DEVICE_OFFLINE" -> handleTrustedDeviceOffline(message)
            "TRUSTED_DEVICE_STATUS" -> handleTrustedDeviceStatus(message)
            else -> handleShareEnvelope(message)
        }
    }

    private fun handleShareEnvelope(message: JSONObject) {
        val identity = _viewState.value.androidIdentity ?: return
        if (message.optString("toDeviceId") != identity.deviceId) return

        val source = _viewState.value.trustedDevices.firstOrNull {
            it.device.deviceId == message.optString("fromDeviceId")
        } ?: return

        val cryptoIdentity = identityStore.loadOrCreateCryptoIdentity()
        val decoded = decodeShareEnvelope(
            message = message,
            localDeviceId = identity.deviceId,
            localPrivateKey = cryptoIdentity.privateKey,
            localPublicKey = identity.publicKey,
            peerPublicKey = source.device.publicKey
        )
        if (decoded != null) {
            if (!replayProtector.accept(decoded.envelope)) return

            when (val controlMessage = decoded.controlMessage) {
                is ShareControlMessage.TextShare -> {
                    val payload = controlMessage.payload
                    if (payload.fromDeviceId != decoded.envelope.fromDeviceId ||
                        payload.toDeviceId != identity.deviceId
                    ) {
                        return
                    }

                    val receivedAt = System.currentTimeMillis()
                    _viewState.update {
                        it.copy(
                            receivedShares = addReceivedShare(
                                it.receivedShares,
                                ReceivedShare(
                                    shareId = payload.shareId,
                                    messageId = decoded.envelope.messageId,
                                    sourceDevice = source.device,
                                    contentType = payload.contentType,
                                    text = payload.text,
                                    receivedAt = receivedAt
                                )
                            ),
                            shareError = null
                        ).withPhase()
                    }
                    scope.launch {
                        try {
                            relayClient.send(
                                createTextShareAckEnvelope(
                                    fromDeviceId = identity.deviceId,
                                    toDeviceId = payload.fromDeviceId,
                                    shareId = payload.shareId,
                                    localPrivateKey = cryptoIdentity.privateKey,
                                    localPublicKey = identity.publicKey,
                                    peerPublicKey = source.device.publicKey,
                                    now = receivedAt
                                ).toJson()
                            )
                        } catch (_: Throwable) {
                            _viewState.update {
                                it.copy(shareError = "Received text, but the acknowledgement could not be sent.")
                                    .withPhase()
                            }
                        }
                    }
                    persistLastSeen(source.device.deviceId, receivedAt)
                }

                is ShareControlMessage.Ack -> {
                    val payload = controlMessage.payload
                    if (payload.toDeviceId != identity.deviceId) return
                    _viewState.update {
                        it.copy(
                            sentShares = markSentShareReceived(it.sentShares, payload.shareId),
                            shareError = null
                        ).withPhase()
                    }
                }

                is ShareControlMessage.Error -> {
                    val payload = controlMessage.payload
                    if (payload.toDeviceId != identity.deviceId || payload.shareId == null) return
                    _viewState.update {
                        it.copy(
                            sentShares = markSentShareFailed(it.sentShares, payload.shareId, payload.message),
                            shareError = payload.message
                        ).withPhase()
                    }
                }

                is ShareControlMessage.LanDiscoveryProbe -> {
                    val payload = controlMessage.payload
                    if (payload.isReachable) {
                        _viewState.update { current ->
                            current.copy(
                                trustedDevices = current.trustedDevices.map { t ->
                                    if (t.device.deviceId == payload.deviceId) {
                                        t.copy(online = true, connectionMode = "lan", localFastPathAvailable = true)
                                    } else t
                                }
                            ).withPhase()
                        }
                    } else {
                        scope.launch {
                            probeLocalCandidatesAndReport(
                                targetDevice = source.device,
                                candidates = payload.localIps,
                                port = payload.port,
                                identity = identity,
                                cryptoIdentity = cryptoIdentity
                            )
                        }
                    }
                }
            }
            return
        }

        val decodedNotification = decodeNotificationEnvelope(
            message = message,
            localDeviceId = identity.deviceId,
            localPrivateKey = cryptoIdentity.privateKey,
            localPublicKey = identity.publicKey,
            peerPublicKey = source.device.publicKey
        )
        if (decodedNotification != null) {
            if (!replayProtector.accept(decodedNotification.envelope)) return

            when (val controlMessage = decodedNotification.controlMessage) {
                is NotificationControlMessage.Dismiss -> {
                    handleIncomingNotificationDismiss(
                        source = source.device,
                        identity = identity,
                        localPrivateKey = cryptoIdentity.privateKey,
                        payload = controlMessage.payload
                    )
                }

                is NotificationControlMessage.Reply -> {
                    handleIncomingNotificationReply(
                        source = source.device,
                        identity = identity,
                        localPrivateKey = cryptoIdentity.privateKey,
                        payload = controlMessage.payload
                    )
                }

                else -> {}
            }
            return
        }

        // Try decoding as file transfer envelope
        val decodedFile = decodeFileTransferEnvelope(
            message = message,
            localDeviceId = identity.deviceId,
            localPrivateKey = cryptoIdentity.privateKey,
            localPublicKey = identity.publicKey,
            peerPublicKey = source.device.publicKey
        ) ?: run {
            _viewState.update {
                it.copy(shareError = "Received an encrypted message that could not be decrypted.")
                    .withPhase()
            }
            return
        }

        if (!replayProtector.accept(decodedFile.envelope)) return

        when (val controlMessage = decodedFile.controlMessage) {
            is FileTransferControlMessage.Offer -> {
                val offer = controlMessage.payload
                val transferState = FileTransferState(
                    transferId = offer.transferId,
                    peerDeviceId = offer.fromDeviceId,
                    fileName = offer.fileName,
                    fileSize = offer.fileSize,
                    direction = offer.direction,
                    bytesTransferred = 0,
                    status = FileTransferStatus.OFFERED,
                    progress = 0,
                    riskyWarning = summarizeRiskyFileWarning(offer.fileName),
                    sha256 = offer.sha256,
                    mimeType = offer.mimeType
                )

                _viewState.update { current ->
                    current.copy(
                        transfers = (listOf(transferState) + current.transfers.filter { it.transferId != offer.transferId }).take(50),
                        shareError = null
                    ).withPhase()
                }
                persistLastSeen(source.device.deviceId, System.currentTimeMillis())
            }

            is FileTransferControlMessage.Accept -> {
                val accept = controlMessage.payload
                val transfer = _viewState.value.transfers.firstOrNull { it.transferId == accept.transferId } ?: return
                if (transfer.status != FileTransferStatus.OFFERED) return

                _viewState.update { current ->
                    current.copy(
                        transfers = current.transfers.map { t ->
                            if (t.transferId == accept.transferId) t.copy(status = FileTransferStatus.TRANSFERRING) else t
                        }
                    ).withPhase()
                }

                startSendingFileChunks(accept.transferId)
            }

            is FileTransferControlMessage.Reject -> {
                val reject = controlMessage.payload
                _viewState.update { current ->
                    current.copy(
                        transfers = current.transfers.map { t ->
                            if (t.transferId == reject.transferId) t.copy(status = FileTransferStatus.REJECTED, error = reject.reason) else t
                        }
                    ).withPhase()
                }
                activeFileTransfers.remove(reject.transferId)
            }

            is FileTransferControlMessage.Chunk -> {
                val chunk = controlMessage.payload
                val transfer = _viewState.value.transfers.firstOrNull { it.transferId == chunk.transferId } ?: return
                if (transfer.status != FileTransferStatus.ACCEPTED && transfer.status != FileTransferStatus.TRANSFERRING) return

                val chunks = receivedChunks.getOrPut(chunk.transferId) { ArrayList() }
                chunks.add(chunk)

                val bytesTransferred = chunks.sumOf { it.byteLength.toLong() }
                val progress = (bytesTransferred * 100 / transfer.fileSize).toInt()

                _viewState.update { current ->
                    current.copy(
                        transfers = current.transfers.map { t ->
                            if (t.transferId == chunk.transferId) {
                                t.copy(status = FileTransferStatus.TRANSFERRING, bytesTransferred = bytesTransferred, progress = progress)
                            } else t
                        }
                    ).withPhase()
                }
            }

            is FileTransferControlMessage.Complete -> {
                val complete = controlMessage.payload
                val transfer = _viewState.value.transfers.firstOrNull { it.transferId == complete.transferId } ?: return
                if (transfer.status != FileTransferStatus.TRANSFERRING) return

                try {
                    val chunks = receivedChunks[complete.transferId] ?: emptyList()
                    val bytes = reassembleTransferredFile(chunks, complete.sha256)
                    val savedPath = saveFile(transfer.fileName, bytes)

                    _viewState.update { current ->
                        current.copy(
                            transfers = current.transfers.map { t ->
                                if (t.transferId == complete.transferId) {
                                    t.copy(status = FileTransferStatus.COMPLETED, progress = 100, savedPath = savedPath)
                                } else t
                            }
                        ).withPhase()
                    }
                } catch (error: Throwable) {
                    val message = error.message ?: "SHA-256 integrity verification failed."
                    _viewState.update { current ->
                        current.copy(
                            transfers = current.transfers.map { t ->
                                if (t.transferId == complete.transferId) {
                                    t.copy(status = FileTransferStatus.FAILED, error = message)
                                } else t
                            }
                        ).withPhase()
                    }
                } finally {
                    receivedChunks.remove(complete.transferId)
                }
            }

            is FileTransferControlMessage.Progress -> {
                // Progress is tracked locally during chunk transfer
            }

            is FileTransferControlMessage.Cancel -> {
                val cancel = controlMessage.payload
                _viewState.update { current ->
                    current.copy(
                        transfers = current.transfers.map { t ->
                            if (t.transferId == cancel.transferId) {
                                t.copy(status = FileTransferStatus.CANCELLED, error = "Cancelled by peer.")
                            } else t
                        }
                    ).withPhase()
                }
                activeFileTransfers.remove(cancel.transferId)
                receivedChunks.remove(cancel.transferId)
            }
        }
    }

    private fun handleTrustedDeviceOnline(message: JSONObject) {
        val payload = message.optJSONObject("payload") ?: return
        val deviceIdentity = payload.optJSONObject("deviceIdentity")?.toDeviceIdentity() ?: return
        val timestamp = payload.optLongOrNull("timestamp") ?: return
        if (payload.optString("connectionMode") != "relay") return
        if (!isTrustedDevice(deviceIdentity.deviceId)) return

        _viewState.update {
            it.copy(
                trustedDevices = applyTrustedDeviceOnline(
                    it.trustedDevices,
                    deviceIdentity,
                    timestamp
                ),
                error = null
            ).withPhase()
        }
        persistLastSeen(deviceIdentity.deviceId, timestamp)
    }

    private fun handleTrustedDeviceOffline(message: JSONObject) {
        val payload = message.optJSONObject("payload") ?: return
        val deviceId = payload.optString("deviceId").trim().takeIf { it.isNotBlank() } ?: return
        val timestamp = payload.optLongOrNull("timestamp") ?: return
        if (!isTrustedDevice(deviceId)) return

        _viewState.update {
            it.copy(
                trustedDevices = applyTrustedDeviceOffline(it.trustedDevices, deviceId, timestamp),
                error = null
            ).withPhase()
        }
        persistLastSeen(deviceId, timestamp)
    }

    private fun handleTrustedDeviceStatus(message: JSONObject) {
        val payload = message.optJSONObject("payload") ?: return
        val deviceId = payload.optString("deviceId").trim().takeIf { it.isNotBlank() } ?: return
        if (!payload.optBoolean("trusted", false)) return
        if (!isTrustedDevice(deviceId)) return
        val online = payload.optBoolean("online", false)
        val lastSeenAt = payload.optLongOrNull("lastSeenAt") ?: return

        _viewState.update {
            it.copy(
                trustedDevices = applyTrustedDeviceStatus(
                    it.trustedDevices,
                    deviceId,
                    online,
                    lastSeenAt
                ),
                error = null
            ).withPhase()
        }
        persistLastSeen(deviceId, lastSeenAt)
    }

    private fun isTrustedDevice(deviceId: String): Boolean {
        return _viewState.value.trustedDevices.any { it.device.deviceId == deviceId }
    }

    private fun persistLastSeen(deviceId: String, lastSeenAt: Long) {
        val device = _viewState.value.trustedDevices
            .firstOrNull { it.device.deviceId == deviceId }
            ?.device
            ?: return
        trustedDeviceStore.saveTrustedDevice(device.copy(lastSeenAt = lastSeenAt))
    }

    private fun DeviceIdentity.toJson(): JSONObject {
        return JSONObject()
            .put("deviceId", deviceId)
            .put("deviceName", deviceName)
            .put("platform", platform)
            .put("publicKey", publicKey)
    }

    private fun JSONObject.toDeviceIdentity(): DeviceIdentity? {
        val deviceId = optString("deviceId").trim().takeIf { it.isNotBlank() } ?: return null
        val deviceName = optString("deviceName").trim().takeIf { it.isNotBlank() } ?: return null
        val platform = optString("platform").trim().takeIf { it == "windows" || it == "android" }
            ?: return null
        val publicKey = optString("publicKey").trim().takeIf { it.isNotBlank() } ?: return null

        return DeviceIdentity(
            deviceId = deviceId,
            deviceName = deviceName,
            platform = platform,
            publicKey = publicKey
        )
    }

    private fun JSONObject.optLongOrNull(field: String): Long? {
        if (!has(field) || isNull(field)) return null
        return try {
            getLong(field)
        } catch (_: JSONException) {
            null
        }
    }
}

internal fun createTrustedDeviceConnections(
    devices: List<TrustedDevice>
): List<TrustedDeviceConnection> {
    return devices.map { device ->
        TrustedDeviceConnection(
            device = device,
            online = false,
            lastSeenAt = device.lastSeenAt,
            localFastPathAvailable = false
        )
    }
}

internal fun applyTrustedDeviceOnline(
    devices: List<TrustedDeviceConnection>,
    deviceIdentity: DeviceIdentity,
    timestamp: Long
): List<TrustedDeviceConnection> {
    return devices.map { entry ->
        if (entry.device.deviceId != deviceIdentity.deviceId) return@map entry
        entry.copy(
            device = entry.device.copy(
                deviceName = deviceIdentity.deviceName,
                platform = deviceIdentity.platform,
                publicKey = deviceIdentity.publicKey,
                lastSeenAt = timestamp
            ),
            online = true,
            connectionMode = if (entry.localFastPathAvailable) "lan" else "relay",
            lastSeenAt = timestamp
        )
    }
}

internal fun applyTrustedDeviceOffline(
    devices: List<TrustedDeviceConnection>,
    deviceId: String,
    timestamp: Long
): List<TrustedDeviceConnection> {
    return devices.map { entry ->
        if (entry.device.deviceId != deviceId) return@map entry
        entry.copy(
            device = entry.device.copy(lastSeenAt = timestamp),
            online = false,
            connectionMode = null,
            localFastPathAvailable = false,
            lastSeenAt = timestamp
        )
    }
}

internal fun applyTrustedDeviceStatus(
    devices: List<TrustedDeviceConnection>,
    deviceId: String,
    online: Boolean,
    lastSeenAt: Long
): List<TrustedDeviceConnection> {
    return devices.map { entry ->
        if (entry.device.deviceId != deviceId) return@map entry
        val fastPath = if (online) entry.localFastPathAvailable else false
        entry.copy(
            device = entry.device.copy(lastSeenAt = lastSeenAt),
            online = online,
            connectionMode = if (online) (if (fastPath) "lan" else "relay") else null,
            localFastPathAvailable = fastPath,
            lastSeenAt = lastSeenAt
        )
    }
}

private fun mergeTrustedDevices(
    current: List<TrustedDeviceConnection>,
    devices: List<TrustedDevice>
): List<TrustedDeviceConnection> {
    val currentById = current.associateBy { it.device.deviceId }
    return devices.map { device ->
        val existing = currentById[device.deviceId]
        TrustedDeviceConnection(
            device = device.copy(lastSeenAt = existing?.lastSeenAt ?: device.lastSeenAt),
            online = existing?.online ?: false,
            connectionMode = existing?.connectionMode?.takeIf { existing.online },
            lastSeenAt = existing?.lastSeenAt ?: device.lastSeenAt,
            localFastPathAvailable = existing?.localFastPathAvailable ?: false
        )
    }
}

private fun trustedPeerIdKey(devices: List<TrustedDeviceConnection>): String {
    return devices.map { it.device.deviceId }.sorted().joinToString("|")
}

private fun ConnectionViewState.withPhase(): ConnectionViewState {
    val nextPhase = when {
        error != null || relayConnectionState == RelayConnectionState.ERROR -> ConnectionPhase.ERROR
        trustedDevices.isEmpty() -> ConnectionPhase.NOT_PAIRED
        relayConnectionState == RelayConnectionState.CONNECTING -> ConnectionPhase.CONNECTING
        relayConnectionState == RelayConnectionState.RECONNECTING -> ConnectionPhase.RECONNECTING
        relayConnectionState == RelayConnectionState.CONNECTED &&
            trustedDevices.any { it.online } -> ConnectionPhase.WINDOWS_DEVICE_ONLINE
        relayConnectionState == RelayConnectionState.CONNECTED -> ConnectionPhase.CONNECTED_TO_RELAY
        else -> ConnectionPhase.PAIRED_DISCONNECTED
    }
    return copy(phase = nextPhase)
}

private val connectedOrConnectingStates = setOf(
    RelayConnectionState.CONNECTED,
    RelayConnectionState.CONNECTING,
    RelayConnectionState.RECONNECTING
)
