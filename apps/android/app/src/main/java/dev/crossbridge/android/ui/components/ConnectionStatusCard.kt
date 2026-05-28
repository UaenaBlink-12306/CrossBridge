package dev.crossbridge.android.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.crossbridge.android.network.ConnectionPhase
import dev.crossbridge.android.network.ConnectionViewState

@Composable
fun ConnectionStatusCard(
    viewState: ConnectionViewState,
    onRelayUrlChange: (String) -> Unit,
    onReconnect: () -> Unit,
    modifier: Modifier = Modifier
) {
    val onlineCount = viewState.trustedDevices.count { it.online }
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        tonalElevation = 1.dp
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                text = connectionStatusText(viewState.phase),
                style = MaterialTheme.typography.titleMedium
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(text = "Relay", style = MaterialTheme.typography.bodyMedium)
                Text(text = viewState.relayConnectionState.name.lowercase(), style = MaterialTheme.typography.bodyMedium)
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(text = "Trusted online", style = MaterialTheme.typography.bodyMedium)
                Text(
                    text = "$onlineCount / ${viewState.trustedDevices.size}",
                    style = MaterialTheme.typography.bodyMedium
                )
            }
            OutlinedTextField(
                modifier = Modifier.fillMaxWidth(),
                value = viewState.relayUrl,
                onValueChange = onRelayUrlChange,
                label = { Text("Android relay URL") },
                singleLine = true
            )
            viewState.error?.let { error ->
                Text(
                    text = error,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium
                )
            }
            Button(
                modifier = Modifier.fillMaxWidth(),
                onClick = onReconnect,
                enabled = viewState.trustedDevices.isNotEmpty() &&
                    viewState.relayConnectionState.name != "CONNECTING" &&
                    viewState.relayConnectionState.name != "RECONNECTING"
            ) {
                Text("Reconnect")
            }
        }
    }
}

fun connectionStatusText(phase: ConnectionPhase): String {
    return when (phase) {
        ConnectionPhase.NOT_PAIRED -> "Not paired"
        ConnectionPhase.PAIRED_DISCONNECTED -> "Paired but disconnected"
        ConnectionPhase.CONNECTING -> "Connecting"
        ConnectionPhase.CONNECTED_TO_RELAY -> "Connected to relay"
        ConnectionPhase.WINDOWS_DEVICE_ONLINE -> "Windows device online"
        ConnectionPhase.RECONNECTING -> "Reconnecting"
        ConnectionPhase.ERROR -> "Error"
    }
}
