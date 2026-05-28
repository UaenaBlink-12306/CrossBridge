package dev.crossbridge.android.network

import android.content.Context
import dev.crossbridge.android.data.AndroidIdentityStore
import dev.crossbridge.android.data.RelayUrlStore
import dev.crossbridge.android.data.TrustedDeviceStore
import dev.crossbridge.android.protocol.DeviceIdentity
import dev.crossbridge.android.protocol.PairingCode
import dev.crossbridge.android.protocol.PairingMessageType
import dev.crossbridge.android.protocol.PairingQrPayload
import dev.crossbridge.android.protocol.TrustedDevice
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

enum class PairingState {
    IDLE,
    QR_SCANNED,
    CONNECTING,
    JOIN_SENT,
    WAITING_FOR_WINDOWS,
    VERIFICATION_READY,
    CONFIRMED,
    COMPLETE,
    EXPIRED,
    ERROR
}

data class PairingViewState(
    val state: PairingState,
    val relayConnected: Boolean = false,
    val qrPayload: PairingQrPayload? = null,
    val verificationCode: String? = null,
    val androidIdentity: DeviceIdentity? = null,
    val pcIdentity: DeviceIdentity? = null,
    val error: String? = null,
    val expiresAt: Long? = null
)

class PairingClient(
    context: Context,
    private val relayClient: RelayClient = RelayClient()
) {
    private val identityStore = AndroidIdentityStore(context)
    private val relayUrlStore = RelayUrlStore(context)
    private val trustedDeviceStore = TrustedDeviceStore(context)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _viewState = MutableStateFlow(PairingViewState(PairingState.IDLE))
    private val unsubscribeRelayMessages: () -> Unit
    private val unsubscribeRelayState: () -> Unit

    val viewState: StateFlow<PairingViewState> = _viewState.asStateFlow()

    private var currentPayload: PairingQrPayload? = null
    private var currentAndroidIdentity: DeviceIdentity? = null
    private var relayWelcome: CompletableDeferred<Unit>? = null
    private var expiryJob: Job? = null

    init {
        unsubscribeRelayMessages = relayClient.onMessage(::handleRelayMessage)
        unsubscribeRelayState = relayClient.onStateChange { relayState ->
            _viewState.update {
                it.copy(relayConnected = relayState == RelayConnectionState.CONNECTED)
            }
        }
    }

    fun startPairing(qrPayload: PairingQrPayload) {
        expiryJob?.cancel()
        currentPayload = qrPayload
        _viewState.value = PairingViewState(
            state = PairingState.QR_SCANNED,
            qrPayload = qrPayload,
            expiresAt = qrPayload.expiresAt
        )

        scope.launch {
            if (qrPayload.expiresAt <= System.currentTimeMillis()) {
                updateState(
                    state = PairingState.EXPIRED,
                    error = "Pairing code has expired. Create a new code on Windows."
                )
                return@launch
            }

            scheduleExpiry(qrPayload)
            val androidIdentity = identityStore.loadOrCreateIdentity()
            currentAndroidIdentity = androidIdentity
            updateState(
                state = PairingState.CONNECTING,
                androidIdentity = androidIdentity,
                error = null
            )

            try {
                relayClient.connect(qrPayload.relayUrl)
                sendRelayHello(androidIdentity)
                sendPairingJoin(qrPayload, androidIdentity)
                updateState(state = PairingState.WAITING_FOR_WINDOWS, error = null)
            } catch (error: Throwable) {
                updateState(
                    state = PairingState.ERROR,
                    error = error.message ?: "Could not join relay pairing."
                )
            }
        }
    }

    fun confirmPairing() {
        val payload = currentPayload ?: return
        val androidIdentity = currentAndroidIdentity ?: return
        val currentState = viewState.value
        if (currentState.state != PairingState.VERIFICATION_READY) return

        scope.launch {
            try {
                relayClient.send(
                    JSONObject()
                        .put("type", PairingMessageType.PAIRING_CONFIRM.wireValue)
                        .put(
                            "payload",
                            JSONObject()
                                .put("pairingSessionId", payload.pairingSessionId)
                                .put("deviceId", androidIdentity.deviceId)
                        )
                )
                updateState(state = PairingState.CONFIRMED, error = null)
            } catch (error: Throwable) {
                updateState(
                    state = PairingState.ERROR,
                    error = error.message ?: "Could not confirm pairing."
                )
            }
        }
    }

    fun reset() {
        expiryJob?.cancel()
        relayClient.disconnect()
        currentPayload = null
        currentAndroidIdentity = null
        relayWelcome = null
        _viewState.value = PairingViewState(PairingState.IDLE)
    }

    fun dispose() {
        expiryJob?.cancel()
        unsubscribeRelayMessages()
        unsubscribeRelayState()
        relayClient.close()
        scope.cancel()
    }

    private suspend fun sendRelayHello(androidIdentity: DeviceIdentity) {
        val welcome = CompletableDeferred<Unit>()
        relayWelcome = welcome
        relayClient.send(
            JSONObject()
                .put("type", "RELAY_HELLO")
                .put("deviceId", androidIdentity.deviceId)
                .put("sessionToken", "session_${UUID.randomUUID().toString().replace("-", "")}")
                .put("protocolVersion", 1)
        )
        try {
            withTimeout(RELAY_HELLO_TIMEOUT_MS) {
                welcome.await()
            }
        } finally {
            if (relayWelcome == welcome) {
                relayWelcome = null
            }
        }
    }

    private suspend fun sendPairingJoin(
        qrPayload: PairingQrPayload,
        androidIdentity: DeviceIdentity
    ) {
        updateState(state = PairingState.JOIN_SENT, error = null)
        relayClient.send(
            JSONObject()
                .put("type", PairingMessageType.PAIRING_JOIN.wireValue)
                .put(
                    "payload",
                    JSONObject()
                        .put("pairingSessionId", qrPayload.pairingSessionId)
                        .put("pairingToken", qrPayload.pairingToken)
                        .put("deviceIdentity", androidIdentity.toJson())
                )
        )
    }

    private fun handleRelayMessage(message: JSONObject) {
        when (message.optString("type")) {
            "RELAY_WELCOME" -> handleRelayWelcome(message)
            "RELAY_ERROR", PairingMessageType.ERROR.wireValue -> handleRelayError(message)
            PairingMessageType.PAIRING_JOINED.wireValue -> handlePairingJoined(message)
            PairingMessageType.PAIRING_COMPLETE.wireValue -> handlePairingComplete(message)
            PairingMessageType.PAIRING_EXPIRED.wireValue -> handlePairingExpired(message)
        }
    }

    private fun handleRelayWelcome(message: JSONObject) {
        val androidIdentity = currentAndroidIdentity ?: return
        if (message.optString("deviceId") == androidIdentity.deviceId) {
            relayWelcome?.complete(Unit)
        }
    }

    private fun handleRelayError(message: JSONObject) {
        val messageText = message.optString("message").ifBlank {
            message.optJSONObject("payload")?.optString("message").orEmpty()
        }.ifBlank {
            "Relay returned an error."
        }
        relayWelcome?.completeExceptionally(IllegalStateException(messageText))
        updateState(state = PairingState.ERROR, error = messageText)
    }

    private fun handlePairingJoined(message: JSONObject) {
        val payload = message.optJSONObject("payload") ?: return
        val qrPayload = currentPayload ?: return
        if (payload.optString("pairingSessionId") != qrPayload.pairingSessionId) return

        val pcIdentity = payload.optJSONObject("pcIdentity")?.toDeviceIdentity()
        val androidIdentity = payload.optJSONObject("androidIdentity")?.toDeviceIdentity()
        val verificationCode = payload.optString("verificationCode")
        if (pcIdentity == null || androidIdentity == null || !verificationCode.matches(CODE_REGEX)) {
            updateState(
                state = PairingState.ERROR,
                error = "Relay pairing response was invalid."
            )
            return
        }

        if (
            pcIdentity.deviceId != qrPayload.pcDeviceId ||
            pcIdentity.publicKey != qrPayload.pcPublicKey
        ) {
            updateState(
                state = PairingState.ERROR,
                error = "Windows identity from relay did not match the QR payload."
            )
            return
        }

        val expectedCode = PairingCode.derive(
            pcPublicKey = pcIdentity.publicKey,
            androidPublicKey = androidIdentity.publicKey,
            pairingSessionId = qrPayload.pairingSessionId
        )
        if (verificationCode != expectedCode) {
            updateState(
                state = PairingState.ERROR,
                error = "Verification code did not match the CrossBridge pairing calculation."
            )
            return
        }

        currentAndroidIdentity = androidIdentity
        updateState(
            state = PairingState.VERIFICATION_READY,
            verificationCode = verificationCode,
            androidIdentity = androidIdentity,
            pcIdentity = pcIdentity,
            error = null
        )
    }

    private fun handlePairingComplete(message: JSONObject) {
        val payload = message.optJSONObject("payload") ?: return
        val qrPayload = currentPayload ?: return
        if (payload.optString("pairingSessionId") != qrPayload.pairingSessionId) return

        val trustedDevices = payload.optJSONArray("trustedDevices").toTrustedDevices()
        val androidIdentity = currentAndroidIdentity
        val windowsDevice = trustedDevices.firstOrNull { trustedDevice ->
            trustedDevice.platform == "windows" &&
                trustedDevice.deviceId != androidIdentity?.deviceId
        }

        if (windowsDevice == null) {
            updateState(
                state = PairingState.ERROR,
                error = "Pairing completed, but Windows trusted-device metadata was missing."
            )
            return
        }

        trustedDeviceStore.saveTrustedDevice(windowsDevice)
        relayUrlStore.saveRelayUrl(qrPayload.relayUrl)
        expiryJob?.cancel()
        updateState(
            state = PairingState.COMPLETE,
            pcIdentity = DeviceIdentity(
                deviceId = windowsDevice.deviceId,
                deviceName = windowsDevice.deviceName,
                platform = windowsDevice.platform,
                publicKey = windowsDevice.publicKey
            ),
            error = null
        )
    }

    private fun handlePairingExpired(message: JSONObject) {
        val payload = message.optJSONObject("payload") ?: return
        val qrPayload = currentPayload ?: return
        if (payload.optString("pairingSessionId") != qrPayload.pairingSessionId) return
        expiryJob?.cancel()
        updateState(
            state = PairingState.EXPIRED,
            expiresAt = payload.optLong("expiresAt", qrPayload.expiresAt),
            error = "Pairing code has expired. Create a new code on Windows."
        )
    }

    private fun scheduleExpiry(qrPayload: PairingQrPayload) {
        expiryJob?.cancel()
        expiryJob = scope.launch {
            delay((qrPayload.expiresAt - System.currentTimeMillis()).coerceAtLeast(0))
            if (currentPayload?.pairingSessionId != qrPayload.pairingSessionId) return@launch
            if (viewState.value.state != PairingState.COMPLETE) {
                updateState(
                    state = PairingState.EXPIRED,
                    error = "Pairing code has expired. Create a new code on Windows."
                )
            }
        }
    }

    private fun updateState(
        state: PairingState? = null,
        relayConnected: Boolean? = null,
        qrPayload: PairingQrPayload? = null,
        verificationCode: String? = null,
        androidIdentity: DeviceIdentity? = null,
        pcIdentity: DeviceIdentity? = null,
        error: String? = null,
        expiresAt: Long? = null
    ) {
        _viewState.update { current ->
            current.copy(
                state = state ?: current.state,
                relayConnected = relayConnected ?: current.relayConnected,
                qrPayload = qrPayload ?: current.qrPayload,
                verificationCode = verificationCode ?: current.verificationCode,
                androidIdentity = androidIdentity ?: current.androidIdentity,
                pcIdentity = pcIdentity ?: current.pcIdentity,
                error = error,
                expiresAt = expiresAt ?: current.expiresAt
            )
        }
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

    private fun JSONArray?.toTrustedDevices(): List<TrustedDevice> {
        if (this == null) return emptyList()
        val devices = mutableListOf<TrustedDevice>()
        for (index in 0 until length()) {
            val device = optJSONObject(index)?.toTrustedDevice() ?: continue
            devices.add(device)
        }
        return devices
    }

    private fun JSONObject.toTrustedDevice(): TrustedDevice? {
        val deviceId = optString("deviceId").trim().takeIf { it.isNotBlank() } ?: return null
        val deviceName = optString("deviceName").trim().takeIf { it.isNotBlank() } ?: return null
        val platform = optString("platform").trim().takeIf { it == "windows" || it == "android" }
            ?: return null
        val publicKey = optString("publicKey").trim().takeIf { it.isNotBlank() } ?: return null
        val pairedAt = optLongOrNull("pairedAt") ?: return null
        val lastSeenAt = optLongOrNull("lastSeenAt")

        return TrustedDevice(
            deviceId = deviceId,
            deviceName = deviceName,
            platform = platform,
            publicKey = publicKey,
            pairedAt = pairedAt,
            lastSeenAt = lastSeenAt
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

    private companion object {
        const val RELAY_HELLO_TIMEOUT_MS = 8_000L
        val CODE_REGEX = Regex("^\\d{6}$")
    }
}
