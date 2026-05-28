package dev.crossbridge.android.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.crossbridge.android.network.PairingState
import dev.crossbridge.android.network.PairingViewState

@Composable
fun PairingStatusCard(viewState: PairingViewState) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        tonalElevation = 1.dp
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = "Pairing status",
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = viewState.state.statusText(),
                style = MaterialTheme.typography.bodyLarge
            )
            Text(
                text = if (viewState.relayConnected) "Relay connected" else "Relay not connected",
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
}

private fun PairingState.statusText(): String {
    return when (this) {
        PairingState.IDLE -> "Idle"
        PairingState.QR_SCANNED -> "QR scanned"
        PairingState.CONNECTING -> "Connecting"
        PairingState.JOIN_SENT -> "Join sent"
        PairingState.WAITING_FOR_WINDOWS -> "Waiting for Windows"
        PairingState.VERIFICATION_READY -> "Verification ready"
        PairingState.CONFIRMED -> "Confirmed on Android"
        PairingState.COMPLETE -> "Complete"
        PairingState.EXPIRED -> "Expired"
        PairingState.ERROR -> "Error"
    }
}
