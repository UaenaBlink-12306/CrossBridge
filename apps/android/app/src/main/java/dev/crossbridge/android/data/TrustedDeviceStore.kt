package dev.crossbridge.android.data

import android.content.Context
import dev.crossbridge.android.protocol.TrustedDevice
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

class TrustedDeviceStore(
    private val store: KeyValueStore,
    private val nowMs: () -> Long = System::currentTimeMillis
) {
    constructor(context: Context) : this(
        store = SharedPreferencesKeyValueStore(
            context.applicationContext.getSharedPreferences(
                "crossbridge_trusted_devices",
                Context.MODE_PRIVATE
            )
        )
    )

    fun loadTrustedDevices(): List<TrustedDevice> {
        val raw = store.getString(KEY_TRUSTED_DEVICES) ?: return emptyList()
        val array = try {
            JSONArray(raw)
        } catch (_: JSONException) {
            return emptyList()
        }

        val byDeviceId = linkedMapOf<String, TrustedDevice>()
        for (index in 0 until array.length()) {
            val device = array.optJSONObject(index)?.toTrustedDevice() ?: continue
            byDeviceId[device.deviceId] = device
        }

        return byDeviceId.values.sortedByDescending { it.pairedAt }
    }

    fun saveTrustedDevice(device: TrustedDevice) {
        if (!device.isValid()) return

        val devices = loadTrustedDevices()
        val existing = devices.firstOrNull { it.deviceId == device.deviceId }
        val savedDevice = if (existing != null) {
            device.copy(lastSeenAt = device.lastSeenAt ?: nowMs())
        } else {
            device
        }

        val nextDevices = listOf(savedDevice)
            .plus(devices.filterNot { it.deviceId == device.deviceId })
            .sortedByDescending { it.pairedAt }

        write(nextDevices)
    }

    fun removeTrustedDevice(deviceId: String) {
        write(loadTrustedDevices().filterNot { it.deviceId == deviceId })
    }

    fun clearTrustedDevices() {
        store.remove(KEY_TRUSTED_DEVICES)
    }

    private fun write(devices: List<TrustedDevice>) {
        val array = JSONArray()
        devices.forEach { array.put(it.toJson()) }
        store.putString(KEY_TRUSTED_DEVICES, array.toString())
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
        ).takeIf { it.isValid() }
    }

    private fun TrustedDevice.toJson(): JSONObject {
        return JSONObject()
            .put("deviceId", deviceId)
            .put("deviceName", deviceName)
            .put("platform", platform)
            .put("publicKey", publicKey)
            .put("pairedAt", pairedAt)
            .also { json ->
                if (lastSeenAt != null) json.put("lastSeenAt", lastSeenAt)
            }
    }

    private fun TrustedDevice.isValid(): Boolean {
        return deviceId.isNotBlank() &&
            deviceName.isNotBlank() &&
            (platform == "windows" || platform == "android") &&
            publicKey.isNotBlank() &&
            pairedAt >= 0 &&
            (lastSeenAt == null || lastSeenAt >= 0)
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
        const val KEY_TRUSTED_DEVICES = "trustedDevices"
    }
}
