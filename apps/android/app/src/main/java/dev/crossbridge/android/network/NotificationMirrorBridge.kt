package dev.crossbridge.android.network

object NotificationMirrorBridge {
    @Volatile
    private var onPostedHandler: ((NotificationPostedPayload) -> Unit)? = null
    @Volatile
    private var onRemovedHandler: ((NotificationRemovedPayload) -> Unit)? = null

    fun register(
        onPosted: (NotificationPostedPayload) -> Unit,
        onRemoved: (NotificationRemovedPayload) -> Unit
    ) {
        onPostedHandler = onPosted
        onRemovedHandler = onRemoved
    }

    fun unregister() {
        onPostedHandler = null
        onRemovedHandler = null
    }

    fun post(payload: NotificationPostedPayload) {
        onPostedHandler?.invoke(payload)
    }

    fun remove(payload: NotificationRemovedPayload) {
        onRemovedHandler?.invoke(payload)
    }
}
