package dev.crossbridge.android.data

import android.content.Context

class RelayUrlStore(
    private val store: KeyValueStore
) {
    constructor(context: Context) : this(
        store = SharedPreferencesKeyValueStore(
            context.applicationContext.getSharedPreferences(
                "crossbridge_relay_settings",
                Context.MODE_PRIVATE
            )
        )
    )

    fun loadRelayUrl(): String {
        return store.getString(KEY_RELAY_URL)
            ?.trim()
            ?.takeIf { isWebSocketUrl(it) }
            ?: DEFAULT_ANDROID_RELAY_URL
    }

    fun saveRelayUrl(relayUrl: String) {
        val trimmed = relayUrl.trim()
        if (isWebSocketUrl(trimmed)) {
            store.putString(KEY_RELAY_URL, trimmed)
        }
    }

    private fun isWebSocketUrl(value: String): Boolean {
        return value.startsWith("ws://") || value.startsWith("wss://")
    }

    private companion object {
        const val KEY_RELAY_URL = "relayUrl"
        const val DEFAULT_ANDROID_RELAY_URL = "ws://10.0.2.2:8787/connect"
    }
}
