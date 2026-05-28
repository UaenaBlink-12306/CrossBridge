package dev.crossbridge.android.protocol

data class PairingQrPayload(
    val protocol: String,
    val pairingSessionId: String,
    val relayUrl: String,
    val pcDeviceId: String,
    val pcDeviceName: String,
    val pcPublicKey: String,
    val pairingToken: String,
    val expiresAt: Long
)

data class DeviceIdentity(
    val deviceId: String,
    val deviceName: String,
    val platform: String,
    val publicKey: String
)

data class TrustedDevice(
    val deviceId: String,
    val deviceName: String,
    val platform: String,
    val publicKey: String,
    val pairedAt: Long,
    val lastSeenAt: Long? = null
)

data class LanDiscoveryProbePayload(
    val deviceId: String,
    val localIps: List<String>,
    val port: Int,
    val timestamp: Long,
    val isReachable: Boolean = false
)


enum class PairingMessageType(val wireValue: String) {
    PAIRING_JOIN("PAIRING_JOIN"),
    PAIRING_JOINED("PAIRING_JOINED"),
    PAIRING_CONFIRM("PAIRING_CONFIRM"),
    PAIRING_COMPLETE("PAIRING_COMPLETE"),
    PAIRING_EXPIRED("PAIRING_EXPIRED"),
    ERROR("ERROR");

    companion object {
        fun fromWireValue(value: String): PairingMessageType? {
            return entries.firstOrNull { it.wireValue == value }
        }
    }
}
