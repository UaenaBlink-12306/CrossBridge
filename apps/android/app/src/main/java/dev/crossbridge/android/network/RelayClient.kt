package dev.crossbridge.android.network

import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.WebSocketSession
import io.ktor.websocket.close
import io.ktor.websocket.readText
import java.util.concurrent.CopyOnWriteArraySet
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject

enum class RelayConnectionState {
    DISCONNECTED,
    CONNECTING,
    CONNECTED,
    RECONNECTING,
    ERROR
}

class RelayClient(
    private val httpClient: HttpClient = HttpClient(OkHttp) {
        install(WebSockets)
    }
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val messageHandlers = CopyOnWriteArraySet<(JSONObject) -> Unit>()
    private val stateHandlers = CopyOnWriteArraySet<(RelayConnectionState) -> Unit>()

    @Volatile
    private var state: RelayConnectionState = RelayConnectionState.DISCONNECTED
    private var activeSession: WebSocketSession? = null
    private var currentUrl: String? = null
    private var receiveJob: Job? = null
    private var reconnectJob: Job? = null
    private var reconnectAttempts = 0
    private var manuallyDisconnected = false

    suspend fun connect(relayUrl: String) {
        withContext(Dispatchers.IO) {
            clearReconnect()
            closeActiveSession()
            currentUrl = relayUrl
            manuallyDisconnected = false
            reconnectAttempts = 0
            open(relayUrl, RelayConnectionState.CONNECTING)
        }
    }

    suspend fun send(message: JSONObject) {
        val session = activeSession ?: throw IllegalStateException("Relay socket is not connected.")
        session.outgoing.send(Frame.Text(message.toString()))
    }

    fun disconnect() {
        manuallyDisconnected = true
        clearReconnect()
        receiveJob?.cancel()
        val session = activeSession
        activeSession = null
        scope.launch {
            session?.close(CloseReason(CloseReason.Codes.NORMAL, "Disconnected"))
        }
        setState(RelayConnectionState.DISCONNECTED)
    }

    fun close() {
        disconnect()
        httpClient.close()
        scope.cancel()
    }

    fun onMessage(handler: (JSONObject) -> Unit): () -> Unit {
        messageHandlers.add(handler)
        return { messageHandlers.remove(handler) }
    }

    fun onStateChange(handler: (RelayConnectionState) -> Unit): () -> Unit {
        stateHandlers.add(handler)
        handler(state)
        return { stateHandlers.remove(handler) }
    }

    fun getState(): RelayConnectionState = state

    private suspend fun open(relayUrl: String, openingState: RelayConnectionState) {
        setState(openingState)
        try {
            val session = httpClient.webSocketSession(urlString = relayUrl)
            activeSession = session
            reconnectAttempts = 0
            setState(RelayConnectionState.CONNECTED)
            receiveJob = scope.launch {
                receiveLoop(session)
            }
        } catch (error: Throwable) {
            if (error is CancellationException) throw error
            setState(RelayConnectionState.ERROR)
            throw error
        }
    }

    private suspend fun receiveLoop(session: WebSocketSession) {
        try {
            for (frame in session.incoming) {
                if (frame is Frame.Text) {
                    dispatchMessage(frame.readText())
                }
            }
        } catch (error: Throwable) {
            if (error is CancellationException) throw error
            setState(RelayConnectionState.ERROR)
        } finally {
            val wasActiveSession = activeSession == session
            if (wasActiveSession) {
                activeSession = null
            }
            if (wasActiveSession && !manuallyDisconnected) {
                scheduleReconnect()
            }
        }
    }

    private fun dispatchMessage(raw: String) {
        val json = try {
            JSONObject(raw)
        } catch (_: JSONException) {
            setState(RelayConnectionState.ERROR)
            return
        }

        for (handler in messageHandlers) {
            handler(json)
        }
    }

    private fun scheduleReconnect() {
        val relayUrl = currentUrl
        if (relayUrl == null || reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
            setState(RelayConnectionState.ERROR)
            return
        }

        reconnectAttempts += 1
        setState(RelayConnectionState.RECONNECTING)
        val delayMs = reconnectDelayMs(reconnectAttempts)

        reconnectJob = scope.launch {
            delay(delayMs)
            if (manuallyDisconnected) return@launch
            try {
                open(relayUrl, RelayConnectionState.RECONNECTING)
            } catch (_: Throwable) {
                scheduleReconnect()
            }
        }
    }

    private fun closeActiveSession() {
        receiveJob?.cancel()
        val session = activeSession
        activeSession = null
        if (session != null) {
            scope.launch {
                session.close(CloseReason(CloseReason.Codes.NORMAL, "Reconnecting"))
            }
        }
    }

    private fun clearReconnect() {
        reconnectJob?.cancel()
        reconnectJob = null
    }

    private fun setState(nextState: RelayConnectionState) {
        if (state == nextState) return
        state = nextState
        for (handler in stateHandlers) {
            handler(nextState)
        }
    }

    private companion object {
        const val RECONNECT_MAX_ATTEMPTS = Int.MAX_VALUE
    }
}

internal fun reconnectDelayMs(attempt: Int): Long {
    return when {
        attempt <= 1 -> 1_000L
        attempt == 2 -> 2_000L
        attempt == 3 -> 5_000L
        attempt == 4 -> 10_000L
        else -> 30_000L
    }
}
