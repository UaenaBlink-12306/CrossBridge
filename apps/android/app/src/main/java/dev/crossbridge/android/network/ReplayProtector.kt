package dev.crossbridge.android.network

import android.content.Context
import dev.crossbridge.android.data.KeyValueStore
import dev.crossbridge.android.data.SharedPreferencesKeyValueStore
import org.json.JSONArray
import org.json.JSONObject

class ReplayProtector(
    private val store: KeyValueStore? = null,
    private val storageKey: String = DEFAULT_STORAGE_KEY,
    private val ttlMs: Long = DEFAULT_TTL_MS,
    private val limit: Int = DEFAULT_LIMIT,
    private val nowMs: () -> Long = System::currentTimeMillis
) {
    constructor(context: Context) : this(
        store = SharedPreferencesKeyValueStore(
            context.applicationContext.getSharedPreferences(
                "crossbridge_seen_encrypted_messages",
                Context.MODE_PRIVATE
            )
        )
    )

    private val seen = linkedMapOf<String, Long>()

    init {
        load()
    }

    fun accept(envelope: RelayEnvelope): Boolean {
        val now = nowMs()
        prune(now)
        val key = envelope.replayKey()
        if (seen.containsKey(key)) return false
        seen[key] = now
        prune(now)
        save()
        return true
    }

    private fun load() {
        val raw = store?.getString(storageKey) ?: return
        try {
            val entries = JSONArray(raw)
            for (index in 0 until entries.length()) {
                val entry = entries.optJSONObject(index) ?: continue
                val key = entry.optString("key").takeIf { it.isNotBlank() } ?: continue
                val seenAt = if (entry.has("seenAt")) entry.optLong("seenAt") else continue
                seen[key] = seenAt
            }
            prune(nowMs())
        } catch (_: Exception) {
            // Malformed replay cache should not prevent receiving fresh messages.
        }
    }

    private fun save() {
        val target = store ?: return
        try {
            val entries = JSONArray()
            seen.forEach { (key, seenAt) ->
                entries.put(JSONObject().put("key", key).put("seenAt", seenAt))
            }
            target.putString(storageKey, entries.toString())
        } catch (_: Exception) {
            // Replay protection still works in-memory if persistent storage is blocked.
        }
    }

    private fun prune(now: Long) {
        val expired = seen.filter { (_, seenAt) -> now - seenAt > ttlMs }.keys
        expired.forEach { seen.remove(it) }
        while (seen.size > limit) {
            val oldestKey = seen.minByOrNull { it.value }?.key ?: return
            seen.remove(oldestKey)
        }
    }

    private fun RelayEnvelope.replayKey(): String {
        return listOf(fromDeviceId, toDeviceId, messageId, nonce, keyId.orEmpty()).joinToString("|")
    }

    private companion object {
        const val DEFAULT_STORAGE_KEY = "seenMessages"
        const val DEFAULT_TTL_MS = 30 * 60 * 1_000L
        const val DEFAULT_LIMIT = 512
    }
}
